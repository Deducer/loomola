import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TranscriptPanel } from "@/components/viewer/transcript-panel";

// A name the speaker pipeline couldn't vouch for (needs_review) must look
// uncertain in the transcript itself — not only in a hover tooltip.
const words = [
  { word: "hello", start: 0, end: 0.5, speaker: 0 },
  { word: "there", start: 0.5, end: 1, speaker: 0 },
  { word: "hi", start: 2, end: 2.5, speaker: 1 },
];
const people = [
  { id: "p-ian", displayName: "Ian Cross" },
  { id: "p-sarah", displayName: "Sarah Chen" },
];

function render(needsReview: boolean) {
  return renderToStaticMarkup(
    createElement(TranscriptPanel, {
      mediaId: "m",
      words,
      fullText: "hello there hi",
      currentTime: 0,
      onSeek: () => {},
      people,
      speakerAssignments: [
        { speakerIdx: 0, personId: "p-ian", displayLabelOverride: null, isSuggestion: false, needsReview },
        { speakerIdx: 1, personId: "p-sarah", displayLabelOverride: null, isSuggestion: false },
      ],
    })
  );
}

describe("TranscriptPanel needs_review speakers", () => {
  it("marks a needs-review name as uncertain inline", () => {
    const html = render(true);
    expect(html).toContain("Ian Cross");
    expect(html).toMatch(/data-needs-review="true"[^>]*>Ian Cross<span[^>]*>check\?<\/span>/);
    expect(html.match(/data-needs-review/g)).toHaveLength(1);
  });

  it("renders confirmed names without the marker", () => {
    const html = render(false);
    expect(html).not.toContain("data-needs-review");
    expect(html).not.toContain("check?");
  });
});
