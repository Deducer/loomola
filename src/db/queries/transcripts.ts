import { db } from "@/db";
import { transcripts } from "@/db/schema";
import { eq } from "drizzle-orm";

export type Transcript = typeof transcripts.$inferSelect;

export type WordTimestamp = {
  word: string;
  start: number;
  end: number;
  confidence?: number;
  speaker?: number;
};

export async function insertTranscript(params: {
  mediaObjectId: string;
  deepgramRequestId: string | null;
  providerRequestId?: string | null;
  provider?: string;
  language: string;
  fullText: string;
  wordTimestamps: WordTimestamp[];
}): Promise<Transcript> {
  const [row] = await db
    .insert(transcripts)
    .values({
      mediaObjectId: params.mediaObjectId,
      deepgramRequestId: params.deepgramRequestId,
      provider: params.provider ?? "deepgram",
      providerRequestId: params.providerRequestId ?? params.deepgramRequestId,
      language: params.language,
      fullText: params.fullText,
      wordTimestamps: params.wordTimestamps,
    })
    .returning();
  return row;
}

export async function getTranscriptByRecording(
  mediaObjectId: string
): Promise<Transcript | null> {
  const [row] = await db
    .select()
    .from(transcripts)
    .where(eq(transcripts.mediaObjectId, mediaObjectId))
    .limit(1);
  return row ?? null;
}
