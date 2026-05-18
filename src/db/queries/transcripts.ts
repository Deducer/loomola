import { db } from "@/db";
import { transcripts } from "@/db/schema";
import { desc, eq } from "drizzle-orm";

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
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(transcripts)
      .where(eq(transcripts.mediaObjectId, params.mediaObjectId))
      .orderBy(desc(transcripts.createdAt))
      .limit(1);

    // Deepgram can occasionally deliver an empty callback. Never let
    // a late empty retry clobber a transcript that already has text.
    if (
      existing &&
      existing.fullText.trim().length > 0 &&
      params.fullText.trim().length === 0
    ) {
      return existing;
    }

    await tx
      .delete(transcripts)
      .where(eq(transcripts.mediaObjectId, params.mediaObjectId));

    const [row] = await tx
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
  });
}

export async function insertLiveTranscript(params: {
  mediaObjectId: string;
  providerRequestId?: string | null;
  language: string;
  fullText: string;
  wordTimestamps: WordTimestamp[];
}): Promise<{ transcript: Transcript; inserted: boolean }> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(transcripts)
      .where(eq(transcripts.mediaObjectId, params.mediaObjectId))
      .orderBy(desc(transcripts.createdAt))
      .limit(1);

    // Live snapshots are an immediate-review bridge. Once the durable
    // batch transcript exists, a late live save must never replace it.
    if (
      existing &&
      existing.provider !== "deepgram-live" &&
      existing.fullText.trim().length > 0
    ) {
      return { transcript: existing, inserted: false };
    }

    if (params.fullText.trim().length === 0 && existing) {
      return { transcript: existing, inserted: false };
    }

    await tx
      .delete(transcripts)
      .where(eq(transcripts.mediaObjectId, params.mediaObjectId));

    const [row] = await tx
      .insert(transcripts)
      .values({
        mediaObjectId: params.mediaObjectId,
        deepgramRequestId: params.providerRequestId ?? null,
        provider: "deepgram-live",
        providerRequestId: params.providerRequestId ?? null,
        language: params.language,
        fullText: params.fullText,
        wordTimestamps: params.wordTimestamps,
      })
      .returning();
    return { transcript: row, inserted: true };
  });
}

export async function getTranscriptByRecording(
  mediaObjectId: string
): Promise<Transcript | null> {
  const [row] = await db
    .select()
    .from(transcripts)
    .where(eq(transcripts.mediaObjectId, mediaObjectId))
    .orderBy(desc(transcripts.createdAt))
    .limit(1);
  return row ?? null;
}

export async function updateTranscriptText(params: {
  id: string;
  fullText: string;
  wordTimestamps: WordTimestamp[];
}): Promise<Transcript | null> {
  const [row] = await db
    .update(transcripts)
    .set({
      fullText: params.fullText,
      wordTimestamps: params.wordTimestamps,
    })
    .where(eq(transcripts.id, params.id))
    .returning();
  return row ?? null;
}
