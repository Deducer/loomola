import { describe, expect, it } from "vitest";
import { buildTranscriptEmbeddingChunks } from "@/lib/embeddings/transcript-chunks";
import type { WordTimestamp } from "@/db/queries/transcripts";

function makeWords(count: number): WordTimestamp[] {
  return Array.from({ length: count }, (_, index) => ({
    word: `word${index}`,
    start: index * 0.5,
    end: index * 0.5 + 0.25,
  }));
}

describe("buildTranscriptEmbeddingChunks", () => {
  it("keeps timestamp boundaries in milliseconds", () => {
    const chunks = buildTranscriptEmbeddingChunks("hello world", [
      { word: "hello", start: 1.25, end: 1.5 },
      { word: "world", start: 1.75, end: 2 },
    ]);

    expect(chunks).toEqual([
      {
        chunkIdx: 0,
        text: "hello world",
        startMs: 1250,
        endMs: 2000,
      },
    ]);
  });

  it("chunks long transcripts with overlap", () => {
    const chunks = buildTranscriptEmbeddingChunks("", makeWords(725));

    expect(chunks.length).toBe(3);
    expect(chunks[0].text.startsWith("word0 word1")).toBe(true);
    expect(chunks[1].text.startsWith("word320 word321")).toBe(true);
    expect(chunks[2].text.startsWith("word640 word641")).toBe(true);
  });

  it("falls back to full text when word timestamps are unavailable", () => {
    const chunks = buildTranscriptEmbeddingChunks("alpha beta gamma", null);

    expect(chunks).toEqual([
      {
        chunkIdx: 0,
        text: "alpha beta gamma",
        startMs: 0,
        endMs: 0,
      },
    ]);
  });
});
