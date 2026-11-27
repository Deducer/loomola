import { sql, type SQL } from "drizzle-orm";
import { transcripts } from "@/db/schema";

/**
 * The "heard nothing" rule. `generate-video-insights` uses it to write the
 * "This recording has no detected speech" placeholder instead of calling the
 * LLM, and the recent list / dashboard / share page use it to flag those
 * recordings.
 */
export function transcriptTextIsEmpty(fullText: string): boolean {
  return fullText.trim().length === 0;
}

/**
 * True only when a finished transcript exists and it has no text. A missing
 * transcript (still transcribing, failed) is not "no speech". Neither is an
 * empty live-caption snapshot (`deepgram-live`): the batch transcript that
 * replaces it may still find words.
 */
export function isNoSpeechTranscript(
  transcript: { fullText: string; provider?: string | null } | null | undefined
): boolean {
  if (!transcript) return false;
  if (transcript.provider === "deepgram-live") return false;
  return transcriptTextIsEmpty(transcript.fullText);
}

/**
 * SQL twin of `isNoSpeechTranscript` for list queries that left-join
 * `transcripts` (so the full text never leaves Postgres). `!~ '\S'` is
 * "no non-whitespace character", matching JS `trim()` emptiness.
 */
export const noSpeechSql: SQL<boolean> = sql<boolean>`(
  ${transcripts.id} is not null
  and ${transcripts.provider} <> 'deepgram-live'
  and ${transcripts.fullText} !~ '\\S'
)`;
