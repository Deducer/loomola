import { db } from "@/db";
import { aiOutputs, mediaObjects } from "@/db/schema";
import { eq } from "drizzle-orm";
import type {
  TitleSummary,
  Chapters,
  ActionItems,
} from "@/lib/ai/schemas";

export type AiOutput = typeof aiOutputs.$inferSelect;

/**
 * Inserts a blank ai_outputs row for a recording. Called from the Deepgram
 * webhook right before the four processing jobs are enqueued. Each job
 * then performs a focused UPDATE on the column it owns.
 */
export async function insertBlankAiOutput(
  mediaObjectId: string,
  llmModel: string
): Promise<AiOutput> {
  const [row] = await db
    .insert(aiOutputs)
    .values({
      mediaObjectId,
      llmModel,
    })
    .returning();
  return row;
}

export async function getAiOutputByMedia(
  mediaObjectId: string
): Promise<AiOutput | null> {
  const [row] = await db
    .select()
    .from(aiOutputs)
    .where(eq(aiOutputs.mediaObjectId, mediaObjectId))
    .limit(1);
  return row ?? null;
}

export async function updateTitleSummary(
  mediaObjectId: string,
  data: TitleSummary
): Promise<void> {
  await db
    .update(aiOutputs)
    .set({
      titleSuggested: data.title,
      summary: data.summary,
    })
    .where(eq(aiOutputs.mediaObjectId, mediaObjectId));
}

export async function updateChapters(
  mediaObjectId: string,
  chapters: Chapters["chapters"]
): Promise<void> {
  await db
    .update(aiOutputs)
    .set({ chapters })
    .where(eq(aiOutputs.mediaObjectId, mediaObjectId));
}

export async function updateActionItems(
  mediaObjectId: string,
  actionItems: ActionItems["action_items"]
): Promise<void> {
  await db
    .update(aiOutputs)
    .set({ actionItems })
    .where(eq(aiOutputs.mediaObjectId, mediaObjectId));
}

/**
 * If every processing output is present for this recording, flip status
 * to 'ready'. Idempotent. Called at the end of each of the 4 processing
 * jobs — whichever finishes last is the one that flips status.
 */
export async function flipToReadyIfComplete(
  mediaObjectId: string
): Promise<void> {
  const ai = await getAiOutputByMedia(mediaObjectId);
  if (!ai) return;

  // Title/summary + chapters + action items are all required. Empty arrays
  // (for chapters/action_items) COUNT as complete — they're valid outputs
  // for short/single-topic recordings.
  const hasTitleSummary =
    ai.titleSuggested !== null && ai.summary !== null;
  const hasChapters = ai.chapters !== null;
  const hasActionItems = ai.actionItems !== null;

  const [media] = await db
    .select({
      status: mediaObjects.status,
      thumb: mediaObjects.compositeThumbnailKey,
    })
    .from(mediaObjects)
    .where(eq(mediaObjects.id, mediaObjectId))
    .limit(1);
  if (!media) return;

  const hasThumb = media.thumb !== null;

  if (hasTitleSummary && hasChapters && hasActionItems && hasThumb) {
    await db
      .update(mediaObjects)
      .set({ status: "ready" })
      .where(eq(mediaObjects.id, mediaObjectId));
  }
}
