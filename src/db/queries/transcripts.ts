import { db } from "@/db";
import { transcripts } from "@/db/schema";
import { desc, eq, getTableColumns, sql } from "drizzle-orm";

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
  mediaObjectId: string,
  opts: { includeWordTimestamps?: boolean } = {}
): Promise<Transcript | null> {
  // wordTimestamps is a large jsonb blob (often bigger than fullText). Callers
  // that only need fullText (e.g. the share page, which lazy-loads words into
  // the transcript panel client-side) pass false to skip reading it from
  // Postgres and cut Supabase egress. Defaults true so existing callers are
  // unchanged. Swaps in an empty jsonb literal so the result shape (and the
  // Transcript type) stays intact.
  const includeWordTimestamps = opts.includeWordTimestamps ?? true;
  const columns = getTableColumns(transcripts);
  // search_tsv mirrors fullText in size and is only ever consulted inside SQL
  // WHERE clauses — no caller reads it. Null it out of every read path.
  const base = {
    ...columns,
    searchTsv: sql<string | null>`null` as unknown as typeof columns.searchTsv,
  };
  const selection = includeWordTimestamps
    ? base
    : {
        ...base,
        wordTimestamps:
          sql<unknown>`'[]'::jsonb` as unknown as typeof columns.wordTimestamps,
      };
  const [row] = await db
    .select(selection)
    .from(transcripts)
    .where(eq(transcripts.mediaObjectId, mediaObjectId))
    .orderBy(desc(transcripts.createdAt))
    .limit(1);
  return row ?? null;
}

/**
 * Returns just the latest transcript's word-timing array for a recording.
 * Backs the lazy /api/v/[slug]/transcript-words endpoint so the full
 * wordTimestamps blob is fetched only when a viewer opens the transcript.
 */
export async function getTranscriptWordsByRecording(
  mediaObjectId: string
): Promise<WordTimestamp[]> {
  const [row] = await db
    .select({ wordTimestamps: transcripts.wordTimestamps })
    .from(transcripts)
    .where(eq(transcripts.mediaObjectId, mediaObjectId))
    .orderBy(desc(transcripts.createdAt))
    .limit(1);
  return Array.isArray(row?.wordTimestamps)
    ? (row.wordTimestamps as WordTimestamp[])
    : [];
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
