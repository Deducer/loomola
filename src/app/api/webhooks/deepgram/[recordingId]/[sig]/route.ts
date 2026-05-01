import { NextResponse } from "next/server";
import { verifyRecordingSignature } from "@/lib/deepgram/callback-signature";
import { db } from "@/db";
import { mediaObjects } from "@/db/schema";
import { eq } from "drizzle-orm";
import { insertTranscript, type WordTimestamp } from "@/db/queries/transcripts";
import { insertBlankAiOutput } from "@/db/queries/ai-outputs";
import { enqueueAiJobs } from "@/lib/queue/enqueue-processing";
import { enableGranola } from "@/lib/feature-flags";
import { listDictionaryTerms } from "@/db/queries/dictionary-terms";
import {
  buildVariantReplacementMap,
  collapseDictionaryVariants,
} from "@/lib/dictionary/transcript-rewrite";

type DeepgramWord = {
  word: string;
  start: number;
  end: number;
  confidence?: number;
  punctuated_word?: string;
  speaker?: number;
};

type DeepgramAlternative = {
  transcript?: string;
  confidence?: number;
  words?: DeepgramWord[];
};

type DeepgramChannel = {
  alternatives?: DeepgramAlternative[];
  detected_language?: string;
};

type DeepgramCallbackBody = {
  metadata?: {
    request_id?: string;
    created?: string;
  };
  results?: {
    channels?: DeepgramChannel[];
  };
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ recordingId: string; sig: string }> }
) {
  const { recordingId, sig } = await params;

  if (!verifyRecordingSignature(recordingId, sig)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const body = (await request.json()) as DeepgramCallbackBody;
  const channel = body.results?.channels?.[0];
  const alt = channel?.alternatives?.[0];
  const words = alt?.words ?? [];
  const rawFullText = alt?.transcript ?? "";
  const language = channel?.detected_language ?? "en";
  const requestId = body.metadata?.request_id ?? null;

  const wordTimestamps: WordTimestamp[] = words.map((w) => ({
    word: w.punctuated_word ?? w.word,
    start: w.start,
    end: w.end,
    confidence: w.confidence,
    speaker: w.speaker,
  }));

  const [media] = await db
    .select({ type: mediaObjects.type, ownerId: mediaObjects.ownerId })
    .from(mediaObjects)
    .where(eq(mediaObjects.id, recordingId))
    .limit(1);
  if (!media) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (media.type === "audio" && !enableGranola()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const replacements = buildVariantReplacementMap(
    await listDictionaryTerms(media.ownerId)
  );
  const rewritten = collapseDictionaryVariants(
    rawFullText,
    wordTimestamps,
    replacements
  );

  await insertTranscript({
    mediaObjectId: recordingId,
    deepgramRequestId: requestId,
    provider: "deepgram",
    providerRequestId: requestId,
    language,
    fullText: rewritten.fullText,
    wordTimestamps: rewritten.words,
  });

  if (media.type === "audio") {
    await db
      .update(mediaObjects)
      .set({ status: "ready" })
      .where(eq(mediaObjects.id, recordingId));

    console.log(
      `[webhook/deepgram] audio transcript saved for ${recordingId} (${wordTimestamps.length} words)`
    );

    return NextResponse.json({ ok: true });
  }

  // Pre-create the ai_outputs row so the 3 UPDATE-based jobs have a target.
  const llmModel = process.env.LLM_MODEL ?? process.env.LLM_MODEL_ID ?? "claude-sonnet-4-6";
  await insertBlankAiOutput(recordingId, llmModel);

  // Flip to 'processing' and fan out the 3 transcript-dependent AI jobs.
  // Thumbnail + preview-sprite were already enqueued at upload-complete
  // time (they don't need the transcript). The last job to finish — AI
  // or thumbnail — calls flipToReadyIfComplete and moves status to 'ready'.
  await db
    .update(mediaObjects)
    .set({ status: "processing" })
    .where(eq(mediaObjects.id, recordingId));

  try {
    await enqueueAiJobs({ mediaObjectId: recordingId });
  } catch (err) {
    console.error(
      `[webhook/deepgram] failed to enqueue AI jobs for ${recordingId}:`,
      err
    );
  }

  console.log(
    `[webhook/deepgram] transcript saved, processing jobs enqueued for ${recordingId} (${wordTimestamps.length} words)`
  );

  return NextResponse.json({ ok: true });
}
