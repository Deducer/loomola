import { generateObjectWithFallback } from "@/lib/ai/with-fallback";
import { titleSummarySchema } from "@/lib/ai/schemas";
import { getTranscriptByRecording } from "@/db/queries/transcripts";
import {
  updateTitleSummary,
  flipToReadyIfComplete,
} from "@/db/queries/ai-outputs";

export const TITLE_SUMMARY_JOB = "generate_title_summary";

export type TitleSummaryJobData = { mediaObjectId: string };

export async function runTitleSummaryJob(
  data: TitleSummaryJobData
): Promise<void> {
  const transcript = await getTranscriptByRecording(data.mediaObjectId);
  if (!transcript) {
    throw new Error(
      `[title-summary] transcript not found for ${data.mediaObjectId}`
    );
  }

  const text = transcript.fullText.trim();
  if (text.length === 0) {
    await updateTitleSummary(data.mediaObjectId, {
      title: "Untitled recording",
      summary: "This recording has no detected speech.",
    });
    await flipToReadyIfComplete(data.mediaObjectId);
    return;
  }

  const { object } = await generateObjectWithFallback({
    schema: titleSummarySchema,
    schemaName: "TitleSummary",
    prompt: [
      "You write titles and summaries for screen-recorded videos from their transcripts.",
      "",
      "Rules:",
      "- Title: 3-12 words, sentence case, no quotes, no trailing period.",
      "- Summary: 2-3 sentences covering WHAT the recording is about, not how long it is.",
      "- Focus on the substantive content. Ignore filler (ums, false starts).",
      "- If the transcript is unclear or mostly silence, say so honestly.",
      "",
      "Transcript:",
      text,
    ].join("\n"),
  });

  await updateTitleSummary(data.mediaObjectId, object);
  await flipToReadyIfComplete(data.mediaObjectId);

  console.log(
    `[title-summary] completed for ${data.mediaObjectId}: "${object.title}"`
  );
}
