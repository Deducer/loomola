import { replaceTranscriptChunkEmbeddings } from "@/db/queries/embeddings";
import { getTranscriptByRecording } from "@/db/queries/transcripts";
import { getEmbeddingAdapter } from "@/lib/embeddings/openai";
import { buildTranscriptEmbeddingChunks } from "@/lib/embeddings/transcript-chunks";

export const EMBED_TRANSCRIPT_JOB = "embed_transcript";

export type EmbedTranscriptJobData = { mediaObjectId: string };

const EMBEDDING_BATCH_SIZE = 64;

export async function runEmbedTranscriptJob(
  data: EmbedTranscriptJobData
): Promise<void> {
  const transcript = await getTranscriptByRecording(data.mediaObjectId);
  if (!transcript) {
    throw new Error(
      `[embed-transcript] transcript not found for ${data.mediaObjectId}`
    );
  }

  const chunks = buildTranscriptEmbeddingChunks(
    transcript.fullText,
    transcript.wordTimestamps
  );

  if (chunks.length === 0) {
    await replaceTranscriptChunkEmbeddings(data.mediaObjectId, []);
    console.log(`[embed-transcript] no transcript text for ${data.mediaObjectId}`);
    return;
  }

  const adapter = getEmbeddingAdapter();
  const embeddings: number[][] = [];

  for (let start = 0; start < chunks.length; start += EMBEDDING_BATCH_SIZE) {
    const batch = chunks.slice(start, start + EMBEDDING_BATCH_SIZE);
    embeddings.push(...(await adapter.embed(batch.map((chunk) => chunk.text))));
  }

  await replaceTranscriptChunkEmbeddings(
    data.mediaObjectId,
    chunks.map((chunk, index) => ({
      ...chunk,
      embedding: embeddings[index],
      modelVersion: adapter.modelVersion,
    }))
  );

  console.log(
    `[embed-transcript] embedded ${chunks.length} chunks for ${data.mediaObjectId}`
  );
}
