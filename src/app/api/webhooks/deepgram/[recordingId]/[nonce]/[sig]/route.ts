import { NextResponse } from "next/server";
import { verifyAndConsumeCallbackToken } from "@/lib/deepgram/callback-signature";
import { db } from "@/db";
import { mediaObjects } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { insertTranscript, type WordTimestamp } from "@/db/queries/transcripts";
import { insertBlankAiOutput } from "@/db/queries/ai-outputs";
import { enqueueAiJobs } from "@/lib/queue/enqueue-processing";
import { enqueueTranscriptEmbedding } from "@/lib/queue/boss";
import { enableGranola } from "@/lib/feature-flags";
import { listDictionaryTerms } from "@/db/queries/dictionary-terms";
import {
  buildVariantReplacementMap,
  collapseDictionaryVariants,
} from "@/lib/dictionary/transcript-rewrite";
import {
  buildSegmentsFromWords,
  mergeSourceTranscriptSegments,
  sourceForDeepgramChannel,
  speakerForTranscriptSource,
  type SourceTranscriptWord,
} from "@/lib/transcript/source-merge";

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
  {
    params,
  }: {
    params: Promise<{ recordingId: string; nonce: string; sig: string }>;
  }
) {
  const { recordingId, nonce, sig } = await params;

  const ok = await verifyAndConsumeCallbackToken({
    recordingId,
    nonce,
    sig,
  });
  if (!ok) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const body = (await request.json()) as DeepgramCallbackBody;
  const channels = body.results?.channels ?? [];
  const parsedTranscript = parseDeepgramTranscript(channels);
  const language = parsedTranscript.language;
  const requestId = body.metadata?.request_id ?? null;

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
    parsedTranscript.fullText,
    parsedTranscript.wordTimestamps,
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

  if (enableGranola()) {
    try {
      await enqueueTranscriptEmbedding({ mediaObjectId: recordingId });
    } catch (err) {
      console.error(
        `[webhook/deepgram] failed to enqueue transcript embedding for ${recordingId}:`,
        err
      );
    }
  }

  if (media.type === "audio") {
    await db
      .update(mediaObjects)
      .set({ status: "ready", failureReason: null, updatedAt: sql`now()` })
      .where(eq(mediaObjects.id, recordingId));

    console.log(
      `[webhook/deepgram] audio transcript saved for ${recordingId} (${rewritten.words.length} words)`
    );

    return NextResponse.json({ ok: true });
  }

  // Pre-create the ai_outputs row so the 3 UPDATE-based jobs have a target.
  const llmModel =
    process.env.LLM_MODEL ?? process.env.LLM_MODEL_ID ?? "claude-sonnet-4-6";
  await insertBlankAiOutput(recordingId, llmModel);

  // Flip to 'processing' and fan out the 3 transcript-dependent AI jobs.
  // Thumbnail + preview-sprite were already enqueued at upload-complete
  // time (they don't need the transcript). The last job to finish — AI
  // or thumbnail — calls flipToReadyIfComplete and moves status to 'ready'.
  await db
    .update(mediaObjects)
    .set({ status: "processing", updatedAt: sql`now()` })
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
    `[webhook/deepgram] transcript saved, processing jobs enqueued for ${recordingId} (${rewritten.words.length} words)`
  );

  return NextResponse.json({ ok: true });
}

function parseDeepgramTranscript(channels: DeepgramChannel[]): {
  fullText: string;
  language: string;
  wordTimestamps: WordTimestamp[];
} {
  if (channels.length > 1) {
    const segments = channels.flatMap((channel, index) => {
      const source = sourceForDeepgramChannel(index);
      const alt = channel.alternatives?.[0];
      const words = (alt?.words ?? []).flatMap((word): SourceTranscriptWord[] => {
        const text = word.punctuated_word ?? word.word;
        if (!text?.trim()) return [];
        return [
          {
            word: text,
            start: word.start,
            end: word.end,
            confidence: word.confidence,
            speaker: speakerForTranscriptSource(source),
          },
        ];
      });
      return buildSegmentsFromWords({
        source,
        transcript: alt?.transcript,
        words,
      });
    });
    const merged = mergeSourceTranscriptSegments(segments);
    return {
      fullText: merged.fullText,
      language: channels.find((channel) => channel.detected_language)?.detected_language ?? "en",
      wordTimestamps: merged.words,
    };
  }

  const channel = channels[0];
  const alt = channel?.alternatives?.[0];
  const words = alt?.words ?? [];
  return {
    fullText: alt?.transcript ?? "",
    language: channel?.detected_language ?? "en",
    wordTimestamps: words.map((word) => ({
      word: word.punctuated_word ?? word.word,
      start: word.start,
      end: word.end,
      confidence: word.confidence,
      speaker: word.speaker,
    })),
  };
}
