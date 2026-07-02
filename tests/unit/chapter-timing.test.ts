import { describe, it, expect } from "vitest";
import { buildTimedTranscript } from "@/lib/transcript/timed-transcript";
import type { WordTimestamp } from "@/db/queries/transcripts";

describe("buildTimedTranscript", () => {
  it("returns empty string for empty input", () => {
    expect(buildTimedTranscript([])).toBe("");
  });

  it("groups words into ~10-second lines", () => {
    const words: WordTimestamp[] = [
      { word: "hello", start: 0, end: 0.5 },
      { word: "world", start: 0.6, end: 1.0 },
      { word: "and", start: 12.0, end: 12.2 },
      { word: "goodbye", start: 12.3, end: 12.8 },
    ];
    const out = buildTimedTranscript(words);
    expect(out).toContain("[0s] hello world");
    expect(out).toContain("[12s] and goodbye");
  });

  it("includes the final partial line", () => {
    const words: WordTimestamp[] = [
      { word: "only", start: 0, end: 0.5 },
      { word: "line", start: 1.0, end: 1.5 },
    ];
    const out = buildTimedTranscript(words);
    expect(out).toBe("[0s] only line");
  });
});
