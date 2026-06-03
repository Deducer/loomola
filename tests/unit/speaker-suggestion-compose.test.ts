import { describe, it, expect } from "vitest";
import { composeSpeakerSuggestions } from "@/lib/speaker-suggestion/compose";
import type { WordTimestamp } from "@/db/queries/transcripts";
import type { PersonCandidate } from "@/lib/speaker-suggestion/match-person";

const SELF: PersonCandidate = {
  id: "ian",
  displayName: "Ian Cross",
  email: "ian@example.com",
};
const SARAH: PersonCandidate = {
  id: "sarah",
  displayName: "Sarah Chen",
  email: "sarah@example.com",
};
const ALEX: PersonCandidate = {
  id: "alex",
  displayName: "Alex Park",
  email: "alex@example.com",
};

function w(speaker: number, durSec: number): WordTimestamp[] {
  // Splits dur into 1-second words for realism.
  const result: WordTimestamp[] = [];
  for (let i = 0; i < Math.ceil(durSec); i++) {
    result.push({
      word: "x",
      start: i,
      end: Math.min(i + 1, durSec),
      speaker,
    });
  }
  return result;
}

describe("composeSpeakerSuggestions", () => {
  it("returns [] when there's no self-Person", () => {
    const r = composeSpeakerSuggestions({
      words: [...w(0, 30), ...w(1, 5)],
      attendees: [{ displayName: "Sarah Chen", email: "sarah@example.com" }],
      people: [SARAH],
      selfPersonId: null,
    });
    expect(r).toEqual([]);
  });

  it("returns [] when attendees is empty", () => {
    const r = composeSpeakerSuggestions({
      words: [...w(0, 30), ...w(1, 5)],
      attendees: [],
      people: [SELF, SARAH],
      selfPersonId: SELF.id,
    });
    expect(r).toEqual([]);
  });

  it("returns [] when fewer than 2 speakers detected", () => {
    const r = composeSpeakerSuggestions({
      words: w(0, 30),
      attendees: [{ displayName: "Sarah Chen", email: "sarah@example.com" }],
      people: [SELF, SARAH],
      selfPersonId: SELF.id,
    });
    expect(r).toEqual([]);
  });

  it("happy 1:1 path: 2 speakers, 1 known attendee, 1 self-Person => 2 suggestions", () => {
    const r = composeSpeakerSuggestions({
      // Speaker 0: 30s (host). Speaker 1: 5s (guest).
      words: [...w(0, 30), ...w(1, 5)],
      attendees: [{ displayName: "Sarah Chen", email: "sarah@example.com" }],
      people: [SELF, SARAH],
      selfPersonId: SELF.id,
    });
    // Two suggestions: speaker 0 -> self, speaker 1 -> sarah.
    expect(r).toHaveLength(2);
    const bySpeaker = new Map(r.map((s) => [s.speakerIdx, s]));
    expect(bySpeaker.get(0)?.personId).toBe(SELF.id);
    expect(bySpeaker.get(0)?.confidence).toBe("high");
    expect(bySpeaker.get(1)?.personId).toBe(SARAH.id);
    expect(bySpeaker.get(1)?.confidence).toBe("high");
  });

  it("source-separated 1:1 path maps mic to self and system audio to attendee", () => {
    const r = composeSpeakerSuggestions({
      // Speaker 0 is the user's mic and speaker 1 is system/call audio.
      // The remote attendee talks more, so duration-based self detection
      // would pick the wrong speaker if we ignored the source channels.
      words: [...w(0, 5), ...w(1, 30)],
      attendees: [
        {
          personId: SARAH.id,
          displayName: null,
          email: null,
        },
      ],
      people: [SELF, SARAH],
      selfPersonId: SELF.id,
      sourceSeparated: true,
    });
    expect(r).toHaveLength(2);
    const bySpeaker = new Map(r.map((s) => [s.speakerIdx, s]));
    expect(bySpeaker.get(0)?.personId).toBe(SELF.id);
    expect(bySpeaker.get(0)?.reason).toBe("self_via_source_channel");
    expect(bySpeaker.get(1)?.personId).toBe(SARAH.id);
    expect(bySpeaker.get(1)?.reason).toBe("person_id_exact");
  });

  it("happy 3-person path: 3 speakers, 2 known attendees", () => {
    const r = composeSpeakerSuggestions({
      // Speaker 0: 30s (host). Speakers 1, 2: 10s each.
      words: [...w(0, 30), ...w(1, 10), ...w(2, 10)],
      attendees: [
        { displayName: "Sarah Chen", email: "sarah@example.com" },
        { displayName: "Alex Park", email: "alex@example.com" },
      ],
      people: [SELF, SARAH, ALEX],
      selfPersonId: SELF.id,
    });
    expect(r).toHaveLength(3);
    const bySpeaker = new Map(r.map((s) => [s.speakerIdx, s]));
    expect(bySpeaker.get(0)?.personId).toBe(SELF.id);
    // Two non-self speakers, two attendees in order.
    expect(bySpeaker.get(1)?.personId).toBe(SARAH.id);
    expect(bySpeaker.get(2)?.personId).toBe(ALEX.id);
  });

  it("attendee count mismatch (3 speakers, 1 attendee) => no suggestions", () => {
    const r = composeSpeakerSuggestions({
      words: [...w(0, 30), ...w(1, 10), ...w(2, 10)],
      attendees: [{ displayName: "Sarah Chen", email: "sarah@example.com" }],
      people: [SELF, SARAH],
      selfPersonId: SELF.id,
    });
    expect(r).toEqual([]);
  });

  it("unknown attendee => suggestedNewPerson populated", () => {
    const r = composeSpeakerSuggestions({
      words: [...w(0, 30), ...w(1, 5)],
      attendees: [{ displayName: "Marcus Bell", email: "marcus@x.com" }],
      people: [SELF],
      selfPersonId: SELF.id,
    });
    expect(r).toHaveLength(2);
    const guest = r.find((s) => s.speakerIdx === 1);
    expect(guest?.personId).toBeNull();
    expect(guest?.suggestedNewPerson).toEqual({
      displayName: "Marcus Bell",
      email: "marcus@x.com",
    });
  });

  it("returns [] when self-detection ties (balanced speech)", () => {
    const r = composeSpeakerSuggestions({
      // 50.0 vs 49.5 — tie within 5%.
      words: [...w(0, 50), ...w(1, 49.5)],
      attendees: [{ displayName: "Sarah Chen", email: "sarah@example.com" }],
      people: [SELF, SARAH],
      selfPersonId: SELF.id,
    });
    expect(r).toEqual([]);
  });
});
