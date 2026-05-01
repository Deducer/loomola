import { db } from "@/db";
import { summaryEmbeddings, transcriptChunks } from "@/db/schema";
import { eq } from "drizzle-orm";

export type TranscriptChunkEmbedding = {
  chunkIdx: number;
  text: string;
  startMs: number;
  endMs: number;
  embedding: number[];
  modelVersion: string;
};

export async function replaceTranscriptChunkEmbeddings(
  mediaObjectId: string,
  chunks: TranscriptChunkEmbedding[]
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(transcriptChunks)
      .where(eq(transcriptChunks.mediaObjectId, mediaObjectId));

    if (chunks.length === 0) return;

    await tx.insert(transcriptChunks).values(
      chunks.map((chunk) => ({
        mediaObjectId,
        chunkIdx: chunk.chunkIdx,
        text: chunk.text,
        startMs: chunk.startMs,
        endMs: chunk.endMs,
        embedding: chunk.embedding,
        modelVersion: chunk.modelVersion,
      }))
    );
  });
}

export async function upsertSummaryEmbedding(params: {
  mediaObjectId: string;
  embedding: number[];
  modelVersion: string;
}): Promise<void> {
  await db
    .insert(summaryEmbeddings)
    .values({
      mediaObjectId: params.mediaObjectId,
      embedding: params.embedding,
      modelVersion: params.modelVersion,
      generatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: summaryEmbeddings.mediaObjectId,
      set: {
        embedding: params.embedding,
        modelVersion: params.modelVersion,
        generatedAt: new Date(),
      },
    });
}

export async function deleteSummaryEmbedding(
  mediaObjectId: string
): Promise<void> {
  await db
    .delete(summaryEmbeddings)
    .where(eq(summaryEmbeddings.mediaObjectId, mediaObjectId));
}
