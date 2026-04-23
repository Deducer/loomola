import { generateObject } from "ai";
import { getLlm } from "@/lib/ai/client";
import { chaptersSchema } from "@/lib/ai/schemas";
import { getTranscriptByRecording, type WordTimestamp } from "@/db/queries/transcripts";
import {
  updateChapters,
  flipToReadyIfComplete,
} from "@/db/queries/ai-outputs";

export const CHAPTERS_JOB = "generate_chapters";

export type ChaptersJobData = { mediaObjectId: string };

/**
 * Serializes word timestamps in a compact "[Ns] word word word" form
 * every ~10 seconds so the LLM has rough time markers without being
 * overwhelmed by individual word data.
 */
export function buildTimedTranscript(words: WordTimestamp[]): string {
  if (words.length === 0) return "";
  const lines: string[] = [];
  let lineStart = words[0].start;
  let lineWords: string[] = [];
  for (const w of words) {
    if (w.start - lineStart >= 10 && lineWords.length > 0) {
      lines.push(`[${Math.floor(lineStart)}s] ${lineWords.join(" ")}`);
      lineStart = w.start;
      lineWords = [];
    }
    lineWords.push(w.word);
  }
  if (lineWords.length > 0) {
    lines.push(`[${Math.floor(lineStart)}s] ${lineWords.join(" ")}`);
  }
  return lines.join("\n");
}

export async function runChaptersJob(data: ChaptersJobData): Promise<void> {
  const transcript = await getTranscriptByRecording(data.mediaObjectId);
  if (!transcript) {
    throw new Error(`[chapters] transcript not found for ${data.mediaObjectId}`);
  }

  const words = transcript.wordTimestamps as WordTimestamp[];
  if (!Array.isArray(words) || words.length === 0) {
    await updateChapters(data.mediaObjectId, []);
    await flipToReadyIfComplete(data.mediaObjectId);
    return;
  }

  const durationSec = words[words.length - 1]?.end ?? 0;
  if (durationSec < 60) {
    await updateChapters(data.mediaObjectId, []);
    await flipToReadyIfComplete(data.mediaObjectId);
    return;
  }

  const timed = buildTimedTranscript(words);
  const { object } = await generateObject({
    model: getLlm(),
    schema: chaptersSchema,
    schemaName: "Chapters",
    prompt: [
      "You write chapter markers for screen recordings from their time-stamped transcripts.",
      "",
      "Rules:",
      "- Return between 0 and 8 chapters.",
      "- The first chapter (if any) MUST start at 0.",
      "- Chapters must be strictly increasing in start_sec.",
      "- Each chapter title is 2-10 words, sentence case, no period.",
      "- Return an EMPTY array if the recording has no natural topic shifts.",
      "- Only pick chapter boundaries where the speaker clearly transitions.",
      "",
      `Recording duration: ${Math.ceil(durationSec)} seconds.`,
      "",
      "Timed transcript (seconds in brackets):",
      timed,
    ].join("\n"),
  });

  const clamped = object.chapters.map((c) => ({
    start_sec: Math.min(c.start_sec, durationSec),
    title: c.title,
  }));

  await updateChapters(data.mediaObjectId, clamped);
  await flipToReadyIfComplete(data.mediaObjectId);

  console.log(
    `[chapters] completed for ${data.mediaObjectId}: ${clamped.length} chapters`
  );
}
