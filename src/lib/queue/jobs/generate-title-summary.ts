import { generateObjectWithFallback } from "@/lib/ai/with-fallback";
import { enhancedNotesSchema, titleSummarySchema } from "@/lib/ai/schemas";
import { db } from "@/db";
import { mediaObjects } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getNotesByMediaObjectForJob } from "@/db/queries/notes";
import { getTranscriptByRecording } from "@/db/queries/transcripts";
import {
  updateTitleSummary,
  flipToReadyIfComplete,
} from "@/db/queries/ai-outputs";

export const TITLE_SUMMARY_JOB = "generate_title_summary";

export type TitleSummaryJobData = { mediaObjectId: string };

export function buildAudioNotesEnhancementPrompt(params: {
  title: string | null;
  rawNotes: string;
  transcript: string;
}): string {
  return [
    "You are an AI meeting note-taker. The user hand-typed raw notes during a meeting, and you also have the transcript.",
    "",
    "Your job is to produce a polished markdown version of the notes that can become the user's primary record of the meeting.",
    "",
    "Critical rules:",
    "- Preserve verbatim any phrase, sentence, or bullet the user wrote that is specific, opinionated, or stylistically distinctive.",
    "- Expand sparse shorthand only when the transcript gives clear context.",
    "- Structure the output with markdown headings and bullets.",
    "- Include action items only when supported by the notes or transcript.",
    "- Do not invent attendees, decisions, or commitments.",
    "- Match the user's apparent voice: terse notes stay terse; detailed notes can become detailed.",
    "",
    `Current title: ${params.title?.trim() || "Untitled note"}`,
    "",
    "# Raw notes",
    params.rawNotes.trim() || "(No raw notes were typed.)",
    "",
    "# Transcript",
    params.transcript.trim() || "(No transcript text.)",
  ].join("\n");
}

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
  const [media] = await db
    .select({ type: mediaObjects.type, title: mediaObjects.title })
    .from(mediaObjects)
    .where(eq(mediaObjects.id, data.mediaObjectId))
    .limit(1);

  if (text.length === 0) {
    await updateTitleSummary(data.mediaObjectId, {
      title: "Untitled recording",
      summary: "This recording has no detected speech.",
    });
    await flipToReadyIfComplete(data.mediaObjectId);
    return;
  }

  if (media?.type === "audio") {
    const note = await getNotesByMediaObjectForJob(data.mediaObjectId);
    const { object } = await generateObjectWithFallback({
      schema: enhancedNotesSchema,
      schemaName: "EnhancedNotes",
      prompt: buildAudioNotesEnhancementPrompt({
        title: media.title,
        rawNotes: note?.body ?? "",
        transcript: text,
      }),
    });

    await updateTitleSummary(data.mediaObjectId, object);
    console.log(
      `[title-summary] enhanced audio note for ${data.mediaObjectId}: "${object.title}"`
    );
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
