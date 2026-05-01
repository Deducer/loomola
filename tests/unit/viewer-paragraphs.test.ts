import { describe, it, expect } from "vitest";
import {
  groupWordsIntoParagraphs,
  findActiveParagraphIndex,
  type Word,
} from "@/lib/viewer/paragraphs";

function w(word: string, start: number, end: number): Word {
  return { word, start, end };
}

describe("groupWordsIntoParagraphs", () => {
  it("returns an empty array for no words", () => {
    expect(groupWordsIntoParagraphs([])).toEqual([]);
  });

  it("groups a single short utterance into one paragraph", () => {
    const words = [w("hello", 0, 0.5), w("world", 0.6, 1.2)];
    const result = groupWordsIntoParagraphs(words);
    expect(result).toHaveLength(1);
    expect(result[0].startSec).toBe(0);
    expect(result[0].endSec).toBe(1.2);
    expect(result[0].text).toBe("hello world");
  });

  it("splits on a long pause", () => {
    const words = [
      w("first", 0, 1),
      w("sentence", 1.1, 2),
      w("second", 10, 11),
      w("sentence", 11.1, 12),
    ];
    const result = groupWordsIntoParagraphs(words, { maxGapSec: 1.5 });
    expect(result).toHaveLength(2);
    expect(result[0].text).toBe("first sentence");
    expect(result[1].text).toBe("second sentence");
    expect(result[1].startSec).toBe(10);
  });

  it("splits on max paragraph length even without a long pause", () => {
    const words = Array.from({ length: 100 }, (_, i) => w("word", i, i + 0.9));
    const result = groupWordsIntoParagraphs(words, {
      maxGapSec: 5,
      maxParagraphSec: 30,
    });
    expect(result.length).toBeGreaterThan(1);
    result.forEach((p) => {
      expect(p.endSec - p.startSec).toBeLessThanOrEqual(31);
    });
  });

  it("uses punctuated_word when present", () => {
    const words: Word[] = [
      { word: "hello", start: 0, end: 0.5, punctuated_word: "Hello," },
      { word: "world", start: 0.6, end: 1.2, punctuated_word: "world." },
    ];
    expect(groupWordsIntoParagraphs(words)[0].text).toBe("Hello, world.");
  });

  it("splits when the speaker changes", () => {
    const words: Word[] = [
      { word: "hello", start: 0, end: 0.5, speaker: 0 },
      { word: "there", start: 0.6, end: 1.2, speaker: 0 },
      { word: "hi", start: 1.3, end: 1.8, speaker: 1 },
    ];

    const result = groupWordsIntoParagraphs(words);

    expect(result).toHaveLength(2);
    expect(result[0].speaker).toBe(0);
    expect(result[1].speaker).toBe(1);
  });
});

describe("findActiveParagraphIndex", () => {
  const paragraphs = [
    { startSec: 0, endSec: 5, text: "a" },
    { startSec: 5, endSec: 12, text: "b" },
    { startSec: 12, endSec: 20, text: "c" },
  ];

  it("returns -1 for empty input", () => {
    expect(findActiveParagraphIndex([], 3)).toBe(-1);
  });

  it("returns 0 before the first paragraph", () => {
    expect(findActiveParagraphIndex(paragraphs, -1)).toBe(0);
  });

  it("returns the last index past the end", () => {
    expect(findActiveParagraphIndex(paragraphs, 999)).toBe(2);
  });

  it("finds the paragraph containing the timestamp", () => {
    expect(findActiveParagraphIndex(paragraphs, 0)).toBe(0);
    expect(findActiveParagraphIndex(paragraphs, 4.9)).toBe(0);
    expect(findActiveParagraphIndex(paragraphs, 5)).toBe(1);
    expect(findActiveParagraphIndex(paragraphs, 11.9)).toBe(1);
    expect(findActiveParagraphIndex(paragraphs, 12)).toBe(2);
    expect(findActiveParagraphIndex(paragraphs, 19.9)).toBe(2);
  });
});
