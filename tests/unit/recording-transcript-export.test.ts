import { describe, expect, it } from "vitest";
import {
  buildRecordingTranscriptMarkdown,
  buildRecordingTranscriptSrt,
  recordingTranscriptFilename,
  type RecordingTranscriptPayload,
} from "@/lib/recordings/transcript-export";

describe("recording transcript export", () => {
  it("builds timestamped markdown from word timings", () => {
    const markdown = buildRecordingTranscriptMarkdown(basePayload());

    expect(markdown).toContain("# Product Demo");
    expect(markdown).toContain("- Recording: https://loom.dissonance.cloud/v/demo");
    expect(markdown).toContain("[0:03] We should ship this.");
    expect(markdown).toContain("[0:10] It gives the viewer a transcript.");
  });

  it("builds SRT captions from word timings", () => {
    const srt = buildRecordingTranscriptSrt(basePayload());

    expect(srt).toContain("1\n00:00:03,200 --> 00:00:05,200");
    expect(srt).toContain("We should ship this.");
    expect(srt).toContain("2\n00:00:10,100 --> 00:00:13,200");
    expect(srt).toContain("It gives the viewer a transcript.");
  });

  it("uses a stable transcript filename", () => {
    expect(recordingTranscriptFilename(basePayload(), "srt")).toBe(
      "2026-06-08-product-demo-transcript.srt"
    );
  });
});

function basePayload(): RecordingTranscriptPayload {
  return {
    title: "Product Demo",
    slug: "demo",
    createdAt: "2026-06-08T14:30:00.000Z",
    durationSeconds: "18.5",
    shareUrl: "https://loom.dissonance.cloud/v/demo",
    fullText: "We should ship this. It gives the viewer a transcript.",
    wordTimestamps: [
      { word: "We", start: 3.2, end: 3.5 },
      { word: "should", start: 3.6, end: 4.0 },
      { word: "ship", start: 4.1, end: 4.6 },
      { word: "this", punctuated_word: "this.", start: 4.7, end: 5.2 },
      { word: "It", start: 10.1, end: 10.4 },
      { word: "gives", start: 10.5, end: 10.9 },
      { word: "the", start: 11.0, end: 11.2 },
      { word: "viewer", start: 11.3, end: 11.8 },
      { word: "a", start: 11.9, end: 12.0 },
      {
        word: "transcript",
        punctuated_word: "transcript.",
        start: 12.1,
        end: 13.2,
      },
    ],
  };
}
