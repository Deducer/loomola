import { describe, expect, it } from "vitest";
import {
  buildAttributionTranscript,
  buildSpeakerUtterances,
  verifyAttributions,
  type RawAttribution,
} from "@/lib/speaker-suggestion/attribute-llm";

const TRANSCRIPT = [
  "Welcome everyone let's get started",
  "Thanks Maya happy to be here",
  "Priya what do you think about the entrainment defaults",
  "I think we should keep singing bowls as the default",
].join("\n");

function raw(overrides: Partial<RawAttribution>): RawAttribution {
  return {
    speakerIdx: 1,
    attendeeName: "Maya",
    confidence: "high",
    evidence: "Thanks Maya happy to be here",
    ...overrides,
  };
}

describe("verifyAttributions — the never-misattribute gate", () => {
  const base = {
    attendeeNames: ["Maya", "Priya", "Sam Ortiz"],
    speakerIdxs: [1, 2, 3],
    transcriptText: TRANSCRIPT,
  };

  it("keeps a high-confidence attribution whose evidence appears verbatim", () => {
    const result = verifyAttributions({ raw: [raw({})], ...base });
    expect(result).toEqual([
      {
        speakerIdx: 1,
        attendeeName: "Maya",
        evidence: "Thanks Maya happy to be here",
      },
    ]);
  });

  it("normalizes punctuation and casing when matching evidence", () => {
    const result = verifyAttributions({
      raw: [raw({ evidence: "Thanks, Maya — happy to be here!" })],
      ...base,
    });
    expect(result).toHaveLength(1);
  });

  it("drops attributions whose evidence is not in the transcript", () => {
    const result = verifyAttributions({
      raw: [raw({ evidence: "Maya said she would handle the rollout" })],
      ...base,
    });
    expect(result).toEqual([]);
  });

  it("drops non-high confidence even with valid evidence", () => {
    expect(
      verifyAttributions({ raw: [raw({ confidence: "medium" })], ...base })
    ).toEqual([]);
  });

  it("drops names that are not attendees", () => {
    expect(
      verifyAttributions({ raw: [raw({ attendeeName: "Sarah" })], ...base })
    ).toEqual([]);
  });

  it("drops null names and speakers that were not asked about", () => {
    expect(
      verifyAttributions({ raw: [raw({ attendeeName: null })], ...base })
    ).toEqual([]);
    expect(
      verifyAttributions({ raw: [raw({ speakerIdx: 7 })], ...base })
    ).toEqual([]);
  });

  it("drops too-short evidence quotes", () => {
    expect(
      verifyAttributions({ raw: [raw({ evidence: "Thanks" })], ...base })
    ).toEqual([]);
  });

  it("a conflict drops EVERY involved attribution, not the loser", () => {
    const result = verifyAttributions({
      raw: [
        raw({ speakerIdx: 1, attendeeName: "Maya" }),
        raw({
          speakerIdx: 2,
          attendeeName: "Maya",
          evidence: "Priya what do you think about the entrainment defaults",
        }),
        raw({
          speakerIdx: 3,
          attendeeName: "Priya",
          evidence: "I think we should keep singing bowls as the default",
        }),
      ],
      ...base,
    });
    // Maya claimed by two speakers → both dropped; Priya survives.
    expect(result).toEqual([
      {
        speakerIdx: 3,
        attendeeName: "Priya",
        evidence: "I think we should keep singing bowls as the default",
      },
    ]);
  });

  it("matches attendee names case-insensitively but returns canonical spelling", () => {
    const result = verifyAttributions({
      raw: [raw({ attendeeName: "maya" })],
      ...base,
    });
    expect(result[0]?.attendeeName).toBe("Maya");
  });
});

describe("buildSpeakerUtterances", () => {
  it("groups consecutive same-speaker words and skips unspeakered words", () => {
    const utterances = buildSpeakerUtterances([
      { word: "Hello", start: 0, end: 0.4, speaker: 0 },
      { word: "there", start: 0.4, end: 0.8, speaker: 0 },
      { word: "hi", start: 1, end: 1.2, speaker: 1 },
      { word: "orphan", start: 2, end: 2.2 },
      { word: "back", start: 3, end: 3.3, speaker: 0 },
    ]);
    expect(utterances).toEqual([
      { speakerIdx: 0, startSec: 0, text: "Hello there" },
      { speakerIdx: 1, startSec: 1, text: "hi" },
      { speakerIdx: 0, startSec: 3, text: "back" },
    ]);
  });
});

describe("buildAttributionTranscript", () => {
  it("returns the full transcript when under the cap", () => {
    const text = buildAttributionTranscript({
      utterances: [
        { speakerIdx: 0, startSec: 0, text: "Hello" },
        { speakerIdx: 1, startSec: 65, text: "Hi there" },
      ],
      attendeeNames: ["Maya"],
    });
    expect(text).toBe("[Speaker 1 @ 0:00] Hello\n[Speaker 2 @ 1:05] Hi there");
  });

  it("keeps name mentions with neighbors when over the cap", () => {
    const filler = Array.from({ length: 300 }, (_, i) => ({
      speakerIdx: 0,
      startSec: i * 10,
      text: `filler segment number ${i} with some padding words here`,
    }));
    const utterances = [
      ...filler,
      { speakerIdx: 1, startSec: 3000, text: "before the mention" },
      { speakerIdx: 0, startSec: 3010, text: "thanks Maya that was great" },
      { speakerIdx: 1, startSec: 3020, text: "after the mention" },
    ];
    const text = buildAttributionTranscript({
      utterances,
      attendeeNames: ["Maya"],
      maxChars: 6000,
    });
    expect(text).toContain("thanks Maya that was great");
    expect(text).toContain("before the mention");
    expect(text).toContain("after the mention");
    expect(text).toContain("[…]");
    expect(text.length).toBeLessThanOrEqual(6100);
  });
});
