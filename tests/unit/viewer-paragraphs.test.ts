import { describe, it, expect } from "vitest";
import { groupWordsIntoParagraphs, type Word } from "@/lib/viewer/paragraphs";

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
});
