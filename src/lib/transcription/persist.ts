import { db } from "@/db";
import { mediaObjects } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { insertTranscript } from "@/db/queries/transcripts";
import { insertBlankAiOutput } from "@/db/queries/ai-outputs";
import { enqueueAiJobs } from "@/lib/queue/enqueue-processing";
import { enqueueTranscriptEmbedding } from "@/lib/queue/boss";
import { enableGranola } from "@/lib/feature-flags";
import { listDictionaryTerms } from "@/db/queries/dictionary-terms";
import {
  buildVariantReplacementMap,
  collapseDictionaryVariants,
} from "@/lib/dictionary/transcript-rewrite";
import type { NormalizedTranscript } from "./types";

export type PersistTranscriptResult =
  | { kind: "not_found" }
  | { kind: "audio_ready"; wordCount: number }
  | { kind: "video_processing"; wordCount: number };

/**
 * Everything that must happen after ANY provider produces a transcript:
 * dictionary-variant rewrite, transcript upsert, embedding enqueue, and
 * the status flip — 'ready' for audio notes, or blank ai_outputs +
 * 'processing' + the 3-job AI fan-out for video. Extracted verbatim from
 * the Deepgram webhook so the synchronous openai-whisper path runs the
 * identical downstream pipeline.
 */
export async function persistTranscriptAndFanOut(params: {
  mediaObjectId: string;
  provider: string;
  providerRequestId: string | null;
  transcript: NormalizedTranscript;
}): Promise<PersistTranscriptResult> {
  const { mediaObjectId, provider, providerRequestId, transcript } = params;

  const [media] = await db
    .select({ type: mediaObjects.type, ownerId: mediaObjects.ownerId })
    .from(mediaObjects)
    .where(eq(mediaObjects.id, mediaObjectId))
    .limit(1);
  if (!media) return { kind: "not_found" };
  if (media.type === "audio" && !enableGranola()) return { kind: "not_found" };

  const replacements = buildVariantReplacementMap(
    await listDictionaryTerms(media.ownerId)
  );
  const rewritten = collapseDictionaryVariants(
    transcript.fullText,
    transcript.wordTimestamps,
    replacements
  );

  await insertTranscript({
    mediaObjectId,
    deepgramRequestId: provider === "deepgram" ? providerRequestId : null,
    provider,
    providerRequestId,
    language: transcript.language,
    fullText: rewritten.fullText,
    wordTimestamps: rewritten.words,
  });

  if (enableGranola()) {
    try {
      await enqueueTranscriptEmbedding({ mediaObjectId });
    } catch (err) {
      console.error(
        `[transcript] failed to enqueue transcript embedding for ${mediaObjectId}:`,
        err
      );
    }
  }

  if (media.type === "audio") {
    await db
      .update(mediaObjects)
      .set({ status: "ready", failureReason: null, updatedAt: sql`now()` })
      .where(eq(mediaObjects.id, mediaObjectId));
    return { kind: "audio_ready", wordCount: rewritten.words.length };
  }

  // Pre-create the ai_outputs row so the 3 UPDATE-based jobs have a target.
  const llmModel =
    process.env.LLM_MODEL ?? process.env.LLM_MODEL_ID ?? "claude-sonnet-4-6";
  await insertBlankAiOutput(mediaObjectId, llmModel);

  // Flip to 'processing' and fan out the 3 transcript-dependent AI jobs.
  // Thumbnail + preview-sprite were already enqueued at upload-complete
  // time (they don't need the transcript). The last job to finish — AI
  // or thumbnail — calls flipToReadyIfComplete and moves status to 'ready'.
  await db
    .update(mediaObjects)
    .set({ status: "processing", updatedAt: sql`now()` })
    .where(eq(mediaObjects.id, mediaObjectId));

  try {
    await enqueueAiJobs({ mediaObjectId });
  } catch (err) {
    console.error(
      `[transcript] failed to enqueue AI jobs for ${mediaObjectId}:`,
      err
    );
  }

  return { kind: "video_processing", wordCount: rewritten.words.length };
}
