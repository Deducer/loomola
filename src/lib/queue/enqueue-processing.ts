import { getBoss } from "./boss";
import { db } from "@/db";
import { mediaObjects } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  TITLE_SUMMARY_JOB,
  type TitleSummaryJobData,
} from "./jobs/generate-title-summary";
import { CHAPTERS_JOB, type ChaptersJobData } from "./jobs/generate-chapters";
import {
  ACTION_ITEMS_JOB,
  type ActionItemsJobData,
} from "./jobs/extract-action-items";
import {
  VIDEO_INSIGHTS_JOB,
  type VideoInsightsJobData,
} from "./jobs/generate-video-insights";

const COMMON_OPTIONS = {
  retryLimit: 3,
  retryDelay: 30,
  retryBackoff: true,
  expireInSeconds: 1800,
};

/**
 * Enqueues the transcript-dependent AI work. Called from the Deepgram
 * webhook once the transcript is persisted (and from retry / enhance /
 * dictionary-reapply). Thumbnail and preview-sprite are NOT here — they
 * don't need the transcript and are enqueued earlier, at upload-complete
 * time.
 *
 * Video → one merged `video_insights` job (title+summary+chapters+action
 * items in a single Claude call — the three separate calls each re-billed
 * the same transcript, which dominates input tokens). Audio keeps the
 * three-job fan-out: its notes enhancement is a long free-form generation
 * that shouldn't share a call with structured extraction.
 */
export async function enqueueAiJobs(params: {
  mediaObjectId: string;
}): Promise<void> {
  const boss = await getBoss();
  const [media] = await db
    .select({ type: mediaObjects.type })
    .from(mediaObjects)
    .where(eq(mediaObjects.id, params.mediaObjectId))
    .limit(1);

  if (media?.type === "video") {
    const vi: VideoInsightsJobData = { mediaObjectId: params.mediaObjectId };
    await boss.send(VIDEO_INSIGHTS_JOB, vi, COMMON_OPTIONS);
    return;
  }

  const ts: TitleSummaryJobData = { mediaObjectId: params.mediaObjectId };
  const ch: ChaptersJobData = { mediaObjectId: params.mediaObjectId };
  const ai: ActionItemsJobData = { mediaObjectId: params.mediaObjectId };
  await Promise.all([
    boss.send(TITLE_SUMMARY_JOB, ts, COMMON_OPTIONS),
    boss.send(CHAPTERS_JOB, ch, COMMON_OPTIONS),
    boss.send(ACTION_ITEMS_JOB, ai, COMMON_OPTIONS),
  ]);
}
