import { NextResponse } from "next/server";
import { verifyRecordingSignature } from "@/lib/deepgram/callback-signature";
import { db } from "@/db";
import { mediaObjects } from "@/db/schema";
import { eq } from "drizzle-orm";
import { insertTranscript, type WordTimestamp } from "@/db/queries/transcripts";

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
  { params }: { params: Promise<{ recordingId: string }> }
) {
  const { recordingId } = await params;
  const { searchParams } = new URL(request.url);
  const sig = searchParams.get("sig") ?? "";

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

  await db
    .update(mediaObjects)
    .set({ status: "ready" })
    .where(eq(mediaObjects.id, recordingId));

  console.log(
    `[webhook/deepgram] saved transcript for recording ${recordingId} (${wordTimestamps.length} words)`
  );

  return NextResponse.json({ ok: true });
}
