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
import { THUMBNAIL_JOB, type ThumbnailJobData } from "./jobs/generate-thumbnail";
import {
  PREVIEW_SPRITE_JOB,
  type PreviewSpriteJobData,
} from "./jobs/generate-preview-sprite";

const COMMON_OPTIONS = {
  retryLimit: 3,
  retryDelay: 30,
  retryBackoff: true,
  expireInSeconds: 1800,
};

export async function enqueueProcessingJobs(params: {
  mediaObjectId: string;
  compositeKey: string;
}): Promise<void> {
  const boss = await getBoss();
  const ts: TitleSummaryJobData = { mediaObjectId: params.mediaObjectId };
  const ch: ChaptersJobData = { mediaObjectId: params.mediaObjectId };
  const ai: ActionItemsJobData = { mediaObjectId: params.mediaObjectId };
  const th: ThumbnailJobData = {
    mediaObjectId: params.mediaObjectId,
    compositeKey: params.compositeKey,
  };
  const ps: PreviewSpriteJobData = {
    mediaObjectId: params.mediaObjectId,
    compositeKey: params.compositeKey,
  };
  await Promise.all([
    boss.send(TITLE_SUMMARY_JOB, ts, COMMON_OPTIONS),
    boss.send(CHAPTERS_JOB, ch, COMMON_OPTIONS),
    boss.send(ACTION_ITEMS_JOB, ai, COMMON_OPTIONS),
    boss.send(THUMBNAIL_JOB, th, COMMON_OPTIONS),
    // Preview-sprite is best-effort and not required for status:ready —
    // viewer page hides hover-scrub gracefully when the sprite key is null.
    boss.send(PREVIEW_SPRITE_JOB, ps, COMMON_OPTIONS),
  ]);
}
