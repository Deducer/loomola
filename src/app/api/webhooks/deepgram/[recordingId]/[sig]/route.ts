import { NextResponse } from "next/server";
import { verifyRecordingSignature } from "@/lib/deepgram/callback-signature";
import { db } from "@/db";
import { mediaObjects } from "@/db/schema";
import { eq } from "drizzle-orm";
import { insertTranscript, type WordTimestamp } from "@/db/queries/transcripts";
import { insertBlankAiOutput } from "@/db/queries/ai-outputs";
import { enqueueProcessingJobs } from "@/lib/queue/enqueue-processing";

type DeepgramWord = {
  word: string;
  start: number;
  end: number;
  confidence?: number;
  punctuated_word?: string;
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
  const fullText = alt?.transcript ?? "";
  const language = channel?.detected_language ?? "en";
  const requestId = body.metadata?.request_id ?? null;

  const wordTimestamps: WordTimestamp[] = words.map((w) => ({
    word: w.punctuated_word ?? w.word,
    start: w.start,
    end: w.end,
    confidence: w.confidence,
  }));

  await insertTranscript({
    mediaObjectId: recordingId,
    deepgramRequestId: requestId,
    language,
    fullText,
    wordTimestamps,
  });

  // Fetch the recording to get its composite key (needed for thumbnail job)
  // and ensure it exists before fanning out.
  const [rec] = await db
    .select({
      id: mediaObjects.id,
      r2CompositeKey: mediaObjects.r2CompositeKey,
    })
    .from(mediaObjects)
    .where(eq(mediaObjects.id, recordingId))
    .limit(1);

  if (!rec?.r2CompositeKey) {
    console.error(
      `[webhook/deepgram] recording ${recordingId} has no composite key; skipping processing`
    );
    return NextResponse.json({ ok: true });
  }

  // Pre-create the ai_outputs row so the 4 UPDATE-based jobs have a target.
  const llmModel = process.env.LLM_MODEL_ID ?? "claude-sonnet-4-6";
  await insertBlankAiOutput(recordingId, llmModel);

  // Flip to 'processing' and fan out the 4 jobs. The last job to finish
  // will call flipToReadyIfComplete and move status to 'ready'.
  await db
    .update(mediaObjects)
    .set({ status: "processing" })
    .where(eq(mediaObjects.id, recordingId));

  try {
    await enqueueProcessingJobs({
      mediaObjectId: recordingId,
      compositeKey: rec.r2CompositeKey,
    });
  } catch (err) {
    console.error(
      `[webhook/deepgram] failed to enqueue processing jobs for ${recordingId}:`,
      err
    );
  }

  console.log(
    `[webhook/deepgram] transcript saved, processing jobs enqueued for ${recordingId} (${wordTimestamps.length} words)`
  );

  return NextResponse.json({ ok: true });
}
