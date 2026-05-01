import {
  deleteSummaryEmbedding,
  upsertSummaryEmbedding,
} from "@/db/queries/embeddings";
import { getAiOutputByMedia } from "@/db/queries/ai-outputs";
import { getEmbeddingAdapter } from "@/lib/embeddings/openai";

export const EMBED_SUMMARY_JOB = "embed_summary";

export type EmbedSummaryJobData = { mediaObjectId: string };

export async function runEmbedSummaryJob(
  data: EmbedSummaryJobData
): Promise<void> {
  const ai = await getAiOutputByMedia(data.mediaObjectId);
  const summary = ai?.summary?.trim() ?? "";

  if (!summary) {
    await deleteSummaryEmbedding(data.mediaObjectId);
    console.log(`[embed-summary] no summary text for ${data.mediaObjectId}`);
    return;
  }

  const adapter = getEmbeddingAdapter();
  const [embedding] = await adapter.embed([summary]);

  await upsertSummaryEmbedding({
    mediaObjectId: data.mediaObjectId,
    embedding,
    modelVersion: adapter.modelVersion,
  });

  console.log(`[embed-summary] embedded summary for ${data.mediaObjectId}`);
}
