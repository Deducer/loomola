import { describe, expect, it } from "vitest";
import {
  buildSegmentsFromWords,
  mergeSourceTranscriptSegments,
  sourceForDeepgramChannel,
  suppressEchoSegments,
  type SourceTranscriptSegment,
  type SourceTranscriptWord,
} from "@/lib/transcript/source-merge";

describe("source-aware transcript merge", () => {
  it("maps Deepgram channels to Loomola audio sources", () => {
    expect(sourceForDeepgramChannel(0)).toBe("microphone");
    expect(sourceForDeepgramChannel(1)).toBe("systemAudio");
    expect(sourceForDeepgramChannel(2)).toBe("unknown");
  });

  it("suppresses remote speech echoed into the mic", () => {
    const segments: SourceTranscriptSegment[] = [
      segment("systemAudio", 0, "Oh, there you go. Really?"),
      segment("microphone", 0.2, "Oh, there we go. Really?"),
      segment("systemAudio", 3, "Let's see. I was testing because I'm on the back of the house."),
      segment("microphone", 3.1, "Let's see. I was testing because I'm on the back of the house."),
    ];

    expect(suppressEchoSegments(segments).map((item) => item.text)).toEqual([
      "Oh, there you go. Really?",
      "Let's see. I was testing because I'm on the back of the house.",
    ]);
  });

  it("keeps distinct mic speech near system audio", () => {
    const segments: SourceTranscriptSegment[] = [
      segment("systemAudio", 10, "Gotcha. Or we can turn our video off if that helps."),
      segment("microphone", 10.3, "What's up? Let's test it once everyone is here."),
    ];

    expect(suppressEchoSegments(segments).map((item) => item.text)).toEqual([
      "Gotcha. Or we can turn our video off if that helps.",
      "What's up? Let's test it once everyone is here.",
    ]);
  });

  it("splits sentence-like word groups so local speech survives partial echo", () => {
    const micWords = wordsFromText(
      "Good. It's time for summer. Yeah. Exactly.",
      20
    );
    const systemWords = wordsFromText("Yeah. Exactly.", 22);
    const segments = [
      ...buildSegmentsFromWords({ source: "microphone", words: micWords }),
      ...buildSegmentsFromWords({ source: "systemAudio", words: systemWords }),
    ];
    const merged = mergeSourceTranscriptSegments(segments);

    expect(merged.fullText).toContain("Good.");
    expect(merged.fullText).toContain("It's time for summer.");
    expect(merged.fullText.match(/Yeah/g)).toHaveLength(1);
    expect(merged.words.map((word) => word.speaker)).toEqual([0, 0, 0, 0, 0, 1, 1]);
  });
});

function segment(
  source: "microphone" | "systemAudio",
  startSec: number,
  text: string
): SourceTranscriptSegment {
  const words = wordsFromText(text, startSec);
  return {
    source,
    startSec,
    endSec: words.at(-1)?.end ?? startSec,
    text,
    words,
  };
}

function wordsFromText(text: string, startSec: number): SourceTranscriptWord[] {
  return text.split(/\s+/).map((word, index) => ({
    word,
    start: startSec + index * 0.25,
    end: startSec + index * 0.25 + 0.18,
    confidence: 0.95,
  }));
}
