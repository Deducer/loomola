import { describe, it, expect } from "vitest";
import { buildTranscriptParagraphs } from "@/lib/notes/export";
import type { SpeakerAssignment } from "@/db/queries/speaker-assignments";

// Exports (Obsidian / markdown) are read as the record: an uncertain or
// unconfirmed speaker name must not leave Loomola as an authoritative
// attribution.
const words = [
  { word: "one", start: 0, end: 0.5, speaker: 0 },
  { word: "two", start: 2, end: 2.5, speaker: 1 },
  { word: "three", start: 4, end: 4.5, speaker: 2 },
  { word: "four", start: 6, end: 6.5, speaker: 3 },
];
const people = [
  { id: "ian", displayName: "Ian Cross" },
  { id: "sarah", displayName: "Sarah Chen" },
  { id: "alex", displayName: "Alex Park" },
  { id: "dana", displayName: "Dana Lee" },
] as unknown as Parameters<typeof buildTranscriptParagraphs>[0]["people"];

function row(over: Partial<SpeakerAssignment>): SpeakerAssignment {
  return {
    id: "r", mediaObjectId: "m", speakerIdx: 0, personId: null, displayLabelOverride: null,
    isSuggestion: false, suggestedAt: null, dismissedAt: null, suggestedNewPersonPayload: null,
    suggestionConfidence: null, suggestionEvidence: null, transcriptVersion: null,
    needsReview: false, autoApplied: false, createdAt: new Date(), ...over,
  };
}

describe("note export speaker labels", () => {
  it("exports confirmed names, marks names under review, and never exports suggestions or dismissals", () => {
    const paragraphs = buildTranscriptParagraphs({
      words,
      fallbackText: "",
      people,
      speakerAssignments: [
        row({ speakerIdx: 0, personId: "ian" }),
        row({ speakerIdx: 1, personId: "sarah", needsReview: true }),
        row({ speakerIdx: 2, personId: "alex", isSuggestion: true }),
        row({ speakerIdx: 3, personId: null, dismissedAt: new Date() }),
      ],
    });
    expect(paragraphs.map((p) => p.speaker)).toEqual([
      "Ian Cross",
      "Sarah Chen (unconfirmed)",
      "Speaker 3",
      "Speaker 4",
    ]);
  });
});
