import type { WordTimestamp } from "@/db/queries/transcripts";

export type TranscriptEmbeddingChunk = {
  chunkIdx: number;
  text: string;
  startMs: number;
  endMs: number;
};

const CHUNK_WORDS = 360;
const CHUNK_OVERLAP_WORDS = 40;

function isWordTimestamp(value: unknown): value is WordTimestamp {
  if (!value || typeof value !== "object") return false;
  const word = (value as { word?: unknown }).word;
  const start = (value as { start?: unknown }).start;
  const end = (value as { end?: unknown }).end;
  return (
    typeof word === "string" &&
    typeof start === "number" &&
    typeof end === "number"
  );
}

function timestampsFromUnknown(value: unknown): WordTimestamp[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isWordTimestamp);
}

function pushTextChunks(
  chunks: TranscriptEmbeddingChunk[],
  words: string[]
): void {
  for (let start = 0; start < words.length; start += CHUNK_WORDS) {
    const text = words.slice(start, start + CHUNK_WORDS).join(" ").trim();
    if (!text) continue;
    chunks.push({
      chunkIdx: chunks.length,
      text,
      startMs: 0,
      endMs: 0,
    });
  }
}

export function buildTranscriptEmbeddingChunks(
  fullText: string,
  wordTimestamps: unknown
): TranscriptEmbeddingChunk[] {
  const words = timestampsFromUnknown(wordTimestamps);
  const chunks: TranscriptEmbeddingChunk[] = [];

  if (words.length === 0) {
    const textWords = fullText.trim().split(/\s+/).filter(Boolean);
    pushTextChunks(chunks, textWords);
    return chunks;
  }

  let start = 0;
  while (start < words.length) {
    const end = Math.min(start + CHUNK_WORDS, words.length);
    const window = words.slice(start, end);
    const text = window.map((word) => word.word).join(" ").trim();
    if (text) {
      chunks.push({
        chunkIdx: chunks.length,
        text,
        startMs: Math.max(0, Math.round(window[0].start * 1000)),
        endMs: Math.max(0, Math.round(window[window.length - 1].end * 1000)),
      });
    }

    if (end === words.length) break;
    start = Math.max(end - CHUNK_OVERLAP_WORDS, start + 1);
  }

  return chunks;
}
