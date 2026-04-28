import { getBoss } from "./boss";
import {
  TITLE_SUMMARY_JOB,
  type TitleSummaryJobData,
} from "./jobs/generate-title-summary";
import { CHAPTERS_JOB, type ChaptersJobData } from "./jobs/generate-chapters";
import {
  ACTION_ITEMS_JOB,
  type ActionItemsJobData,
} from "./jobs/extract-action-items";

const COMMON_OPTIONS = {
  retryLimit: 3,
  retryDelay: 30,
  retryBackoff: true,
  expireInSeconds: 1800,
};

/**
 * Enqueues the three transcript-dependent AI jobs (title+summary, chapters,
 * action items). Called from the Deepgram webhook once the transcript is
 * persisted. Thumbnail and preview-sprite are NOT here — they don't need
 * the transcript and are enqueued earlier, at upload-complete time.
 */
export async function enqueueAiJobs(params: {
  mediaObjectId: string;
}): Promise<void> {
  const boss = await getBoss();
  const ts: TitleSummaryJobData = { mediaObjectId: params.mediaObjectId };
  const ch: ChaptersJobData = { mediaObjectId: params.mediaObjectId };
  const ai: ActionItemsJobData = { mediaObjectId: params.mediaObjectId };
  await Promise.all([
    boss.send(TITLE_SUMMARY_JOB, ts, COMMON_OPTIONS),
    boss.send(CHAPTERS_JOB, ch, COMMON_OPTIONS),
    boss.send(ACTION_ITEMS_JOB, ai, COMMON_OPTIONS),
  ]);
}
