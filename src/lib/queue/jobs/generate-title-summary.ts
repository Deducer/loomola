import {
  generateObjectWithFallback,
  generateTextWithFallback,
  describeAiFailure,
} from "@/lib/ai/with-fallback";
import { recordFailureReason } from "@/db/queries/recordings";
import { titleSummarySchema } from "@/lib/ai/schemas";
import { db } from "@/db";
import { mediaObjects } from "@/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  getNotesByMediaObjectForJob,
  listNoteAttachmentsForJob,
} from "@/db/queries/notes";
import { getTranscriptByRecording } from "@/db/queries/transcripts";
import {
  updateTitleSummary,
  markAiOutputFailed,
  flipToReadyIfComplete,
} from "@/db/queries/ai-outputs";
import { presignGet } from "@/lib/r2/presigned-get";
import type { FinishReason, ModelMessage } from "ai";
import {
  buildTemplateInstruction,
  DEFAULT_NOTE_TEMPLATE_ID,
  getNoteTemplate,
  type NoteTemplate,
} from "@/lib/ai/note-templates";
import { getUserPreferences } from "@/db/queries/user-preferences";
import { resolveNoteTemplate } from "@/db/queries/note-templates";
import { listAttendeeNamesForMedia } from "@/db/queries/people";
import { buildSummaryLanguageInstruction } from "@/lib/preferences/user-preferences";
import { normalizeGeneratedNotesMarkdown } from "@/lib/ai/normalize-generated-notes";

export const TITLE_SUMMARY_JOB = "generate_title_summary";

export type TitleSummaryJobData = { mediaObjectId: string };

const LONG_AUDIO_TRANSCRIPT_CHARS = 20_000;

const audioNoteTitleSchema = z.object({
  title: z
    .string()
    .min(3)
    .max(70)
    .describe("A concise meeting-note title, 3 to 8 words, 70 characters or fewer, sentence case, no trailing period."),
});

export function minimumEnhancedNotesChars(transcriptChars: number): number {
  if (transcriptChars < LONG_AUDIO_TRANSCRIPT_CHARS) return 0;
  return Math.min(2_500, Math.max(700, Math.floor(transcriptChars * 0.012)));
}

function looksAbruptlyTruncated(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (/[.!?)]$/.test(trimmed) || trimmed.endsWith("```")) return false;
  const lastWord = trimmed.split(/\s+/).at(-1)?.toLowerCase() ?? "";
  return [
    "a",
    "an",
    "and",
    "as",
    "at",
    "but",
    "for",
    "from",
    "in",
    "of",
    "on",
    "or",
    "that",
    "the",
    "to",
    "with",
  ].includes(lastWord);
}

export function validateAudioNotesEnhancement(params: {
  transcript: string;
  summary: string;
  finishReason?: FinishReason;
}): { ok: true } | { ok: false; reason: string } {
  if (params.finishReason === "length") {
    return { ok: false, reason: "model hit output token limit" };
  }

  const transcriptChars = params.transcript.trim().length;
  const summary = params.summary.trim();
  const minChars = minimumEnhancedNotesChars(transcriptChars);
  if (minChars > 0 && summary.length < minChars) {
    return {
      ok: false,
      reason: `summary too short for transcript (${summary.length} < ${minChars} chars)`,
    };
  }

  if (transcriptChars >= 4_000 && looksAbruptlyTruncated(summary)) {
    return { ok: false, reason: "summary appears abruptly truncated" };
  }

  return { ok: true };
}

export function buildAudioNotesEnhancementPrompt(params: {
  title: string | null;
  sourceContextHint?: string | null;
  template?: NoteTemplate;
  outputLanguageInstruction?: string;
  attachmentNames?: string[];
  attendeeNames?: string[];
  rawNotes: string;
  transcript: string;
}): string {
  const template = params.template ?? getNoteTemplate(DEFAULT_NOTE_TEMPLATE_ID);
  const transcriptCharCount = params.transcript.trim().length;
  const attendeeLine = params.attendeeNames?.length
    ? `Known attendees: ${params.attendeeNames.join(", ")}. Automatic transcription often misspells these names (a similar-sounding name in the transcript is almost certainly one of them) — always use these exact spellings in the notes.`
    : null;
  return [
    "You are an AI meeting note-taker. The user hand-typed raw notes during a meeting, and you also have the transcript.",
    "",
    "Your job is to produce a polished markdown version of the notes that can become the user's primary record of the meeting.",
    "",
    "# Selected note template",
    buildTemplateInstruction(template),
    "",
    "Critical rules:",
    `- ${params.outputLanguageInstruction ?? "Output language: match the transcript language."}`,
    "- Preserve verbatim any phrase, sentence, or bullet the user wrote that is specific, opinionated, or stylistically distinctive.",
    "- Expand sparse shorthand only when the transcript gives clear context.",
    "- Structure the output with markdown headings and bullets.",
    "- Do not use markdown tables or horizontal rules; use heading sections and bullet lists for tasks, owners, and notes.",
    "- Never write a line that is only `---`.",
    "- Use normal markdown bold (`**text**`), never doubled bold markers like `****text****`.",
    "- Include action items only when supported by the notes or transcript.",
    "- Use attached images as visual context when they clarify slides, whiteboards, product screens, diagrams, or UI bugs.",
    "- Do not invent attendees, decisions, or commitments.",
    "- Match the user's apparent voice: terse notes stay terse; detailed notes can become detailed.",
    "- Use the entire transcript, from beginning to end. Do not stop after the first topic.",
    "- For long transcripts, return substantial notes with multiple supported sections and concrete bullets. A brief abstract is a failure.",
    "- Finish the final sentence or bullet completely; never end mid-phrase.",
    "- Return only the polished markdown notes. Do not wrap the notes in JSON or code fences.",
    "",
    ...(attendeeLine ? [attendeeLine, ""] : []),
    `Current title: ${params.title?.trim() || "Untitled note"}`,
    `Source context: ${params.sourceContextHint?.trim() || "Unknown"}`,
    `Selected template id: ${template.id}`,
    `Transcript length: ${transcriptCharCount} characters`,
    `Attached images: ${
      params.attachmentNames?.length
        ? params.attachmentNames.join(", ")
        : "None"
    }`,
    "",
    "# Raw notes",
    params.rawNotes.trim() || "(No raw notes were typed.)",
    "",
    "# Transcript",
    params.transcript.trim() || "(No transcript text.)",
  ].join("\n");
}

export function buildAudioNoteTitlePrompt(params: {
  generatedNotes: string;
  sourceContextHint?: string | null;
}): string {
  return [
    "Write a concise title for these meeting notes.",
    "",
    "Rules:",
    "- 3 to 8 words.",
    "- 70 characters or fewer.",
    "- Sentence case.",
    "- No subtitles, dashes, or colon-separated second clauses.",
    "- No trailing period.",
    "- Do not invent project or company names that are not present.",
    "",
    `Source context: ${params.sourceContextHint?.trim() || "Unknown"}`,
    "",
    "# Generated notes",
    params.generatedNotes.slice(0, 8_000),
  ].join("\n");
}

export function buildAudioNotesEnhancementMessages(params: {
  prompt: string;
  imageAttachments: Array<{
    url: string;
    contentType: string;
  }>;
}): ModelMessage[] {
  if (params.imageAttachments.length === 0) {
    return [{ role: "user", content: params.prompt }];
  }

  return [
    {
      role: "user",
      content: [
        { type: "text", text: params.prompt },
        ...params.imageAttachments.map((attachment) => ({
          type: "image" as const,
          image: new URL(attachment.url),
          mediaType: attachment.contentType,
        })),
      ],
    },
  ];
}

async function generateAudioNoteTitle(params: {
  existingTitle: string | null;
  generatedNotes: string;
  sourceContextHint?: string | null;
}): Promise<string> {
  const existing = params.existingTitle?.trim();
  if (existing) return existing;

  const { object } = await generateObjectWithFallback({
    schema: audioNoteTitleSchema,
    schemaName: "AudioNoteTitle",
    prompt: buildAudioNoteTitlePrompt(params),
  });

  return object.title;
}

async function runTitleSummaryJobInner(
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
    .select({
      type: mediaObjects.type,
      ownerId: mediaObjects.ownerId,
      title: mediaObjects.title,
      sourceContextHint: mediaObjects.sourceContextHint,
    })
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
    const preferences = await getUserPreferences(media.ownerId);
    const note = await getNotesByMediaObjectForJob(data.mediaObjectId);
    const attendeeNames = await listAttendeeNamesForMedia(data.mediaObjectId);
    const attachments = await listNoteAttachmentsForJob(data.mediaObjectId);
    const imageAttachments = await Promise.all(
      attachments.slice(0, 6).map(async (attachment) => ({
        url: await presignGet(attachment.r2Key),
        contentType: attachment.contentType,
      }))
    );
    const prompt = buildAudioNotesEnhancementPrompt({
      title: media.title,
      sourceContextHint: media.sourceContextHint,
      template: await resolveNoteTemplate(media.ownerId, note?.templateId),
      outputLanguageInstruction: buildSummaryLanguageInstruction({
        summaryLanguage: preferences.summaryLanguage,
        transcriptLanguage: transcript.language,
      }),
      attachmentNames: attachments.map((attachment) => attachment.filename),
      attendeeNames,
      rawNotes: note?.body ?? "",
      transcript: text,
    });
    const { text: summary, finishReason } = await generateTextWithFallback({
      // Sized for 5-6 hour event recordings (the longest practical case),
      // which can produce ~15-25K output tokens of structured markdown.
      // Sonnet 4.6 supports up to 64K output tokens natively; 32K is well
      // above realistic worst case and leaves headroom.
      maxOutputTokens: 32000,
      messages: buildAudioNotesEnhancementMessages({
        prompt,
        imageAttachments,
      }),
    });
    const normalizedSummary = normalizeGeneratedNotesMarkdown(summary);
    const validation = validateAudioNotesEnhancement({
      transcript: text,
      summary: normalizedSummary,
      finishReason,
    });
    if (!validation.ok) {
      await markAiOutputFailed(data.mediaObjectId);
      throw new Error(
        `[title-summary] incomplete audio note output for ${data.mediaObjectId}: ${validation.reason}`
      );
    }
    const title = await generateAudioNoteTitle({
      existingTitle: media.title,
      generatedNotes: normalizedSummary,
      sourceContextHint: media.sourceContextHint,
    });

    await updateTitleSummary(data.mediaObjectId, {
      title,
      summary: normalizedSummary,
    });
    console.log(
      `[title-summary] enhanced audio note for ${data.mediaObjectId}: "${title}"`
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
      `- ${buildSummaryLanguageInstruction({
        summaryLanguage: media
          ? (await getUserPreferences(media.ownerId)).summaryLanguage
          : null,
        transcriptLanguage: transcript.language,
      })}`,
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

export async function runTitleSummaryJob(
  data: TitleSummaryJobData
): Promise<void> {
  try {
    await runTitleSummaryJobInner(data);
  } catch (err) {
    // Record WHY before rethrowing — pg-boss owns retries; if they all
    // fail, the watchdog flips status to 'failed' and this reason (not a
    // generic "stuck" message) is what the user sees.
    try {
      await recordFailureReason(data.mediaObjectId, describeAiFailure(err));
    } catch (recordErr) {
      console.error(
        `[title-summary] failed to record failure reason for ${data.mediaObjectId}:`,
        recordErr
      );
    }
    throw err;
  }
}
