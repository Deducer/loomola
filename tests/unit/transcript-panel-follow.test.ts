import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AUTO_FOLLOW_PAUSE_MS,
  TranscriptPanel,
  autoFollowPaused,
  formatTranscriptTimestamp,
} from "@/components/viewer/transcript-panel";

describe("formatTranscriptTimestamp", () => {
  it("formats minutes and seconds", () => {
    expect(formatTranscriptTimestamp(0)).toBe("0:00");
    expect(formatTranscriptTimestamp(65.9)).toBe("1:05");
  });
  it("adds hours past an hour", () => {
    expect(formatTranscriptTimestamp(3725)).toBe("1:02:05");
  });
});

describe("autoFollowPaused", () => {
  it("pauses following right after a manual scroll", () => {
    expect(autoFollowPaused(10_000, 10_000 + AUTO_FOLLOW_PAUSE_MS - 1)).toBe(true);
  });
  it("resumes once the pause window has passed", () => {
    expect(autoFollowPaused(10_000, 10_000 + AUTO_FOLLOW_PAUSE_MS)).toBe(false);
    expect(autoFollowPaused(0, 1_000_000)).toBe(false);
  });
});

describe("TranscriptPanel timestamps", () => {
  const words = [
    { word: "hello", start: 0, end: 0.5 },
    { word: "again", start: 75, end: 75.5 },
  ];
  function render(showTimestamps: boolean, currentTime = 75) {
    return renderToStaticMarkup(
      createElement(TranscriptPanel, {
        words,
        fullText: "hello again",
        currentTime,
        onSeek: () => {},
        showTimestamps,
      })
    );
  }

  it("renders a labelled seek button per paragraph", () => {
    const html = render(true);
    expect(html).toContain('aria-label="Play from 0:00"');
    expect(html).toContain('aria-label="Play from 1:15"');
  });

  it("marks the paragraph at the playhead as current", () => {
    const html = render(true);
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-current="true"[^>]*>again</);
  });

  it("leaves timestamps off unless asked", () => {
    expect(render(false)).not.toContain("Play from");
  });
});
