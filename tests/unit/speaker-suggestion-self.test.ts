import { describe, it, expect } from "vitest";
import { detectSelfSpeakerIdx } from "@/lib/speaker-suggestion/detect-self";
import type { WordTimestamp } from "@/db/queries/transcripts";

function word(
  speaker: number | undefined,
  start: number,
  end: number
): WordTimestamp {
  return { word: "x", start, end, speaker };
}

describe("detectSelfSpeakerIdx", () => {
  it("returns null when there are no words", () => {
    expect(detectSelfSpeakerIdx([])).toBeNull();
  });

  it("returns null when no words have a speaker", () => {
    const words: WordTimestamp[] = [
      word(undefined, 0, 1),
      word(undefined, 1, 2),
    ];
    expect(detectSelfSpeakerIdx(words)).toBeNull();
  });

  it("returns the dominant speaker idx", () => {
    // speaker 0: 30s total. speaker 1: 5s total.
    const words: WordTimestamp[] = [
      word(0, 0, 10),
      word(0, 10, 20),
      word(0, 20, 30),
      word(1, 30, 35),
    ];
    expect(detectSelfSpeakerIdx(words)).toBe(0);
  });

  it("returns the dominant idx even when speakers alternate", () => {
    // speaker 1: 30s. speaker 0: 5s.
    const words: WordTimestamp[] = [
      word(0, 0, 5),
      word(1, 5, 15),
      word(1, 15, 25),
      word(1, 25, 35),
    ];
    expect(detectSelfSpeakerIdx(words)).toBe(1);
  });

  it("returns null when the top two speakers are within 5%", () => {
    // 50.0 vs 49.5 — within 5%.
    const words: WordTimestamp[] = [
      word(0, 0, 50.0),
      word(1, 50.0, 99.5),
    ];
    expect(detectSelfSpeakerIdx(words)).toBeNull();
  });

  it("returns the leader when margin is comfortably above 5%", () => {
    // 100 vs 80 = 25% margin.
    const words: WordTimestamp[] = [
      word(0, 0, 100),
      word(1, 100, 180),
    ];
    expect(detectSelfSpeakerIdx(words)).toBe(0);
  });

  it("ignores words with negative or zero duration", () => {
    const words: WordTimestamp[] = [
      word(0, 5, 5), // zero duration
      word(0, 10, 5), // negative
      word(1, 0, 30),
    ];
    expect(detectSelfSpeakerIdx(words)).toBe(1);
  });

  it("returns the only speaker when only one is present", () => {
    const words: WordTimestamp[] = [word(2, 0, 10)];
    expect(detectSelfSpeakerIdx(words)).toBe(2);
  });
});
