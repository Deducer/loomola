import {
  generateObjectWithFallback,
  describeAiFailure,
} from "@/lib/ai/with-fallback";
import { recordFailureReason } from "@/db/queries/recordings";
import { videoInsightsSchema } from "@/lib/ai/schemas";
import { db } from "@/db";
import { mediaObjects } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  getTranscriptByRecording,
  type WordTimestamp,
} from "@/db/queries/transcripts";
import { buildTimedTranscript } from "@/lib/transcript/timed-transcript";
import {
  updateTitleSummary,
  updateChapters,
  updateActionItems,
  flipToReadyIfComplete,
} from "@/db/queries/ai-outputs";
import { getUserPreferences } from "@/db/queries/user-preferences";
import { buildSummaryLanguageInstruction } from "@/lib/preferences/user-preferences";

export const VIDEO_INSIGHTS_JOB = "video_insights";

export type VideoInsightsJobData = { mediaObjectId: string };

/**
 * One Claude call producing title + summary + chapters + action items for
 * a video recording. Replaces the three separate jobs that each re-sent
 * the same transcript — the transcript dominates input tokens, so this
 * cuts the per-video LLM bill roughly 3x on input. The three legacy jobs
 * remain registered for in-flight queue items and the audio path.
 */
async function runVideoInsightsJobInner(
  data: VideoInsightsJobData
): Promise<void> {
  const transcript = await getTranscriptByRecording(data.mediaObjectId);
  if (!transcript) {
    throw new Error(
      `[video-insights] transcript not found for ${data.mediaObjectId}`
    );
  }

  const text = transcript.fullText.trim();
  if (text.length === 0) {
    await updateTitleSummary(data.mediaObjectId, {
      title: "Untitled recording",
      summary: "This recording has no detected speech.",
    });
    await updateChapters(data.mediaObjectId, []);
    await updateActionItems(data.mediaObjectId, []);
    await flipToReadyIfComplete(data.mediaObjectId);
    return;
  }

  const [media] = await db
    .select({ ownerId: mediaObjects.ownerId })
    .from(mediaObjects)
    .where(eq(mediaObjects.id, data.mediaObjectId))
    .limit(1);

  const words = transcript.wordTimestamps as WordTimestamp[];
  const hasTimings = Array.isArray(words) && words.length > 0;
  const durationSec = hasTimings ? words[words.length - 1]?.end ?? 0 : 0;
  const timedTranscript = hasTimings ? buildTimedTranscript(words) : "";

  const languageInstruction = buildSummaryLanguageInstruction({
    summaryLanguage: media
      ? (await getUserPreferences(media.ownerId)).summaryLanguage
      : null,
    transcriptLanguage: transcript.language,
  });

  const { object } = await generateObjectWithFallback({
    schema: videoInsightsSchema,
    schemaName: "VideoInsights",
    prompt: [
      "You analyze screen-recorded videos from their transcripts and produce a title, a summary, chapter markers, and action items in one pass.",
      "",
      "Rules:",
      `- ${languageInstruction}`,
      "- Title: 3-12 words, sentence case, no quotes, no trailing period.",
      "- Summary: 2-3 sentences covering WHAT the recording is about, not how long it is.",
      "- Focus on the substantive content. Ignore filler (ums, false starts).",
      "- If the transcript is unclear or mostly silence, say so honestly in the summary.",
      "",
      "Chapters:",
      "- Return between 0 and 8 chapters.",
      "- The first chapter (if any) MUST start at 0.",
      "- Chapters must be strictly increasing in start_sec.",
      "- Each chapter title is 2-10 words, sentence case, no period.",
      "- Return an EMPTY array if the recording is under 60 seconds or has no natural topic shifts.",
      "- Only pick chapter boundaries where the speaker clearly transitions.",
      "",
      "Action items:",
      "- Include only items that represent a specific committed action or next step.",
      "- Phrase each as a single imperative sentence (e.g. 'Send Kate the updated mockups').",
      "- If the speaker says 'I'll do X', phrase as 'Do X' — drop the 'I'll'.",
      "- Skip vague ideas, hypotheticals, or casual remarks.",
      "- Return an EMPTY array if there are no concrete next steps.",
      "- Choose the timestamp where the item was discussed or committed (round to the nearest second).",
      "",
      `Recording duration: ${Math.ceil(durationSec)} seconds.`,
      "",
      timedTranscript
        ? "Timed transcript (seconds in brackets):"
        : "Transcript:",
      timedTranscript || text,
    ].join("\n"),
  });

  const chapters =
    durationSec < 60
      ? []
      : object.chapters.map((c) => ({
          start_sec: Math.min(c.start_sec, durationSec),
          title: c.title,
        }));
  const actionItems = object.action_items.map((a) => ({
    text: a.text,
    timestamp_sec: Math.min(Math.max(0, a.timestamp_sec), durationSec || a.timestamp_sec),
  }));

  await updateTitleSummary(data.mediaObjectId, {
    title: object.title,
    summary: object.summary,
  });
  await updateChapters(data.mediaObjectId, chapters);
  await updateActionItems(data.mediaObjectId, actionItems);
  await flipToReadyIfComplete(data.mediaObjectId);

  console.log(
    `[video-insights] completed for ${data.mediaObjectId}: "${object.title}" (${chapters.length} chapters, ${actionItems.length} action items)`
  );
}

export async function runVideoInsightsJob(
  data: VideoInsightsJobData
): Promise<void> {
  try {
    await runVideoInsightsJobInner(data);
  } catch (err) {
    try {
      await recordFailureReason(data.mediaObjectId, describeAiFailure(err));
    } catch (recordErr) {
      console.error(
        `[video-insights] failed to record failure reason for ${data.mediaObjectId}:`,
        recordErr
      );
    }
    throw err;
  }
}
