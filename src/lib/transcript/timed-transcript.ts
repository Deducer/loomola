import type { WordTimestamp } from "@/db/queries/transcripts";

/**
 * Serializes word timestamps in a compact "[Ns] word word word" form
 * every ~10 seconds so LLM jobs get rough time markers without individual
 * word-level noise.
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
