import { describe, it, expect } from "vitest";
import { composeSpeakerSuggestions } from "@/lib/speaker-suggestion/compose";
import { computeSpeakerProfile } from "@/lib/speaker-profile/profile";
import type { PersonCandidate } from "@/lib/speaker-suggestion/match-person";
import { framesFor, framesForTurns, turns, wordsFor, type Turn } from "./fixtures/speaker-v2";

const SELF: PersonCandidate = { id: "ian", displayName: "Ian Cross", email: "ian@example.com" };
const SARAH: PersonCandidate = { id: "sarah", displayName: "Sarah Chen", email: "sarah@example.com" };
const ALEX: PersonCandidate = { id: "alex", displayName: "Alex Park", email: "alex@example.com" };

function batch(t: Turn[], micSpeakers: number[] | null) {
  const words = wordsFor(t);
  return {
    words,
    profile: computeSpeakerProfile({
      words,
      provider: "deepgram",
      activity: micSpeakers ? framesForTurns(t, micSpeakers) : null,
    }),
  };
}

const sarah = [{ personId: SARAH.id, displayName: null, email: null }];

describe("composeSpeakerSuggestions (v2 evidence ladder)", () => {
  it("returns [] without a self-Person", () => {
    const r = composeSpeakerSuggestions({
      ...batch(turns([[0, 30], [1, 30]]), [1]),
      attendees: sarah,
      people: [SARAH],
      selfPersonId: null,
    });
    expect(r).toEqual([]);
  });

  it("1:1: Me from the mic track and the sole remote voice named, both auto-applied", () => {
    // The other person talks more and spoke first — v1 would have
    // labeled them as the recorder.
    const r = composeSpeakerSuggestions({
      ...batch(turns([[0, 80], [1, 20], [0, 60], [1, 15]]), [1]),
      attendees: sarah,
      people: [SELF, SARAH],
      selfPersonId: SELF.id,
    });
    expect(r).toEqual([
      { speakerIdx: 1, personId: SELF.id, confidence: "high", reason: "self_via_mic_capture", autoApply: true },
      { speakerIdx: 0, personId: SARAH.id, confidence: "high", reason: "remote_via_single_voice", autoApply: true },
    ]);
  });

  it("identifies Me even when the note has no attendees", () => {
    const r = composeSpeakerSuggestions({
      ...batch(turns([[0, 40], [1, 40], [2, 40]]), [2]),
      attendees: [],
      people: [SELF],
      selfPersonId: SELF.id,
    });
    expect(r).toEqual([
      { speakerIdx: 2, personId: SELF.id, confidence: "high", reason: "self_via_mic_capture", autoApply: true },
    ]);
  });

  it("never maps group-call voices to attendees by position", () => {
    const r = composeSpeakerSuggestions({
      ...batch(turns([[0, 40], [1, 40], [2, 40]]), [0]),
      attendees: [
        { personId: SARAH.id, displayName: null, email: null },
        { personId: ALEX.id, displayName: null, email: null },
      ],
      people: [SELF, SARAH, ALEX],
      selfPersonId: SELF.id,
    });
    expect(r.map((s) => s.speakerIdx)).toEqual([0]);
  });

  it("two mic-dominant voices (split recorder OR shared mic) are uncertain suggestions, never two auto-applied Me", () => {
    const r = composeSpeakerSuggestions({
      ...batch(turns([[0, 40], [1, 40], [3, 30], [1, 20]]), [0, 3]),
      attendees: sarah,
      people: [SELF, SARAH],
      selfPersonId: SELF.id,
    });
    expect(r.map((s) => [s.speakerIdx, s.personId, s.autoApply, s.needsReview ?? false])).toEqual([
      [0, SELF.id, false, true],
      [3, SELF.id, false, true],
      [1, SARAH.id, true, false],
    ]);
    expect(r.filter((s) => s.personId === SELF.id && s.autoApply)).toHaveLength(0);
  });

  it("doesn't add Me when the user already put the owner on another voice", () => {
    const r = composeSpeakerSuggestions({
      ...batch(turns([[0, 40], [1, 40], [2, 40]]), [0]),
      attendees: [],
      people: [SELF],
      selfPersonId: SELF.id,
      skipIdxs: new Set([2]),
      takenPersonIds: new Set([SELF.id]),
    });
    expect(r).toEqual([]);
  });

  it("ignores diarization fragments when deciding there is one remote voice", () => {
    const r = composeSpeakerSuggestions({
      ...batch(turns([[0, 60], [1, 60], [2, 3]]), [0]),
      attendees: sarah,
      people: [SELF, SARAH],
      selfPersonId: SELF.id,
    });
    expect(r.find((s) => s.speakerIdx === 1)?.personId).toBe(SARAH.id);
    expect(r.find((s) => s.speakerIdx === 2)).toBeUndefined();
  });

  it("doesn't treat a call with a quiet but real third participant as a 1:1", () => {
    // 40 s from voice 2 in a ~50-minute call is under the 2% fragment
    // share, but it's a real person — the invitee may not be the main
    // remote speaker, so no automatic 1:1 name.
    const r = composeSpeakerSuggestions({
      ...batch(turns([[0, 1500], [1, 1500], [2, 40]]), [0]),
      attendees: sarah,
      people: [SELF, SARAH],
      selfPersonId: SELF.id,
    });
    expect(r.map((s) => s.speakerIdx)).toEqual([0]);
  });

  it("needs positive call-audio evidence for the 1:1 name — a 'mixed' voice could be someone at the mic", () => {
    // Voice 1 is barely on system audio (20%): maybe a second person next
    // to the recorder, not the invitee on the call.
    const words = wordsFor(turns([[0, 50], [1, 50]]));
    const activity = framesFor({ durationSec: 100, micOn: [[0, 50], [60, 70]], systemOn: [[50, 60]] });
    const profile = computeSpeakerProfile({ words, provider: "deepgram", activity });
    expect(profile.entries.find((e) => e.speakerIdx === 1)?.source).toBe("mixed");
    const r = composeSpeakerSuggestions({ words, profile, attendees: sarah, people: [SELF, SARAH], selfPersonId: SELF.id });
    expect(r.find((x) => x.personId === SARAH.id)).toBeUndefined();
  });

  it("keeps an unknown attendee as a create-person suggestion, not auto-applied", () => {
    const r = composeSpeakerSuggestions({
      ...batch(turns([[0, 30], [1, 30]]), [0]),
      attendees: [{ displayName: "Marcus Bell", email: "marcus@x.com" }],
      people: [SELF],
      selfPersonId: SELF.id,
    });
    const guest = r.find((s) => s.speakerIdx === 1)!;
    expect(guest.autoApply).toBe(false);
    expect(guest.suggestedNewPerson).toEqual({ displayName: "Marcus Bell", email: "marcus@x.com" });
  });

  it("ignores the recorder if a legacy attendee list includes them", () => {
    const r = composeSpeakerSuggestions({
      ...batch(turns([[0, 30], [1, 30]]), [0]),
      attendees: [{ personId: SELF.id, displayName: null, email: null }, ...sarah],
      people: [SELF, SARAH],
      selfPersonId: SELF.id,
    });
    expect(r.find((s) => s.speakerIdx === 1)?.personId).toBe(SARAH.id);
  });

  it("names nobody when the mic is unusable — no talk-time guessing with tracks present", () => {
    const t = turns([[0, 80], [1, 20]]);
    const words = wordsFor(t);
    const r = composeSpeakerSuggestions({
      words,
      profile: computeSpeakerProfile({ words, provider: "deepgram", activity: framesForTurns(t, [0], { silentMic: true }) }),
      attendees: sarah,
      people: [SELF, SARAH],
      selfPersonId: SELF.id,
    });
    expect(r).toEqual([]);
  });

  it("skips voices that already carry a decision and people already assigned", () => {
    const r = composeSpeakerSuggestions({
      ...batch(turns([[0, 30], [1, 30]]), [0]),
      attendees: sarah,
      people: [SELF, SARAH],
      selfPersonId: SELF.id,
      skipIdxs: new Set([0]),
      takenPersonIds: new Set([SARAH.id]),
    });
    expect(r).toEqual([]);
  });

  it("live transcript: channel 0 is Me; channel 1 is named only on a 1:1", () => {
    const t = turns([[0, 10], [1, 60]]);
    const words = wordsFor(t);
    const profile = computeSpeakerProfile({ words, provider: "deepgram-live", activity: null });
    const oneOnOne = composeSpeakerSuggestions({ words, profile, attendees: sarah, people: [SELF, SARAH], selfPersonId: SELF.id });
    expect(oneOnOne.map((s) => [s.speakerIdx, s.personId, s.reason])).toEqual([
      [0, SELF.id, "self_via_source_channel"],
      [1, SARAH.id, "remote_via_single_voice"],
    ]);
    const group = composeSpeakerSuggestions({
      words,
      profile,
      attendees: [...sarah, { personId: ALEX.id, displayName: null, email: null }],
      people: [SELF, SARAH, ALEX],
      selfPersonId: SELF.id,
    });
    // The system channel is everyone else — never the recorder, never one name.
    expect(group.map((s) => s.speakerIdx)).toEqual([0]);
  });

  it("offers a merged recorder+remote voice as an uncertain 'Me?' and names no remote voice", () => {
    const words = wordsFor([
      { speaker: 0, from: 0, to: 45 },
      { speaker: 0, from: 45, to: 100 },
      { speaker: 1, from: 100, to: 160 },
    ]);
    const profile = computeSpeakerProfile({
      words,
      provider: "deepgram",
      activity: framesForTurns([{ speaker: 0, from: 0, to: 45 }, { speaker: 1, from: 45, to: 160 }], [0]),
    });
    const r = composeSpeakerSuggestions({ words, profile, attendees: sarah, people: [SELF, SARAH], selfPersonId: SELF.id });
    expect(r).toEqual([
      expect.objectContaining({ speakerIdx: 0, personId: SELF.id, autoApply: false, needsReview: true, reason: "self_via_mic_capture_merged" }),
    ]);
  });

  it("no talk-time fallback when the note has one of its two tracks", () => {
    const t = turns([[0, 90], [1, 20]]);
    const words = wordsFor(t);
    const r = composeSpeakerSuggestions({
      words,
      profile: computeSpeakerProfile({ words, provider: "deepgram", activity: null, tracks: "partial" }),
      attendees: sarah,
      people: [SELF, SARAH],
      selfPersonId: SELF.id,
    });
    expect(r).toEqual([]);
  });

  it("suggests (doesn't auto-apply) Me found only by the low-gain mic rule", () => {
    const t = turns([[0, 50], [1, 50]]);
    const words = wordsFor(t);
    // The recorder's mic is loud for only a fifth of their speech.
    const profile = computeSpeakerProfile({
      words,
      provider: "deepgram",
      activity: framesFor({ durationSec: 100, micOn: [[0, 10]], systemOn: [[50, 100]] }),
    });
    const r = composeSpeakerSuggestions({ words, profile, attendees: [], people: [SELF], selfPersonId: SELF.id });
    expect(r).toEqual([expect.objectContaining({ speakerIdx: 0, personId: SELF.id, autoApply: false })]);
  });

  it("never re-applies a kind of name the user dismissed on this note — it becomes a suggestion", () => {
    const r = composeSpeakerSuggestions({
      ...batch(turns([[0, 80], [1, 20], [0, 60], [1, 15]]), [1]),
      attendees: sarah,
      people: [SELF, SARAH],
      selfPersonId: SELF.id,
      dismissedDerivations: new Set(["self_via_source_channel", "remote_via_single_voice"]),
    });
    expect(r.map((s) => [s.speakerIdx, s.personId, s.autoApply])).toEqual([
      [1, SELF.id, false],
      [0, SARAH.id, false],
    ]);
  });

  it("a live system-channel name is only a suggestion (it may hold an uninvited extra voice)", () => {
    const t = turns([[0, 10], [1, 60]]);
    const words = wordsFor(t);
    const r = composeSpeakerSuggestions({
      words,
      profile: computeSpeakerProfile({ words, provider: "deepgram-live", activity: null }),
      attendees: sarah,
      people: [SELF, SARAH],
      selfPersonId: SELF.id,
    });
    expect(r.map((s) => [s.speakerIdx, s.autoApply])).toEqual([
      [0, true],
      [1, false],
    ]);
  });

  it("no tracks: talk-time fallback only for small calls with an overwhelming margin, as a suggestion", () => {
    const dominant = composeSpeakerSuggestions({
      ...batch(turns([[0, 90], [1, 20]]), null),
      attendees: sarah,
      people: [SELF, SARAH],
      selfPersonId: SELF.id,
    });
    expect(dominant).toEqual([
      { speakerIdx: 0, personId: SELF.id, confidence: "high", reason: "self_via_dominant_speech", autoApply: false },
    ]);
    const close = composeSpeakerSuggestions({
      ...batch(turns([[0, 60], [1, 40]]), null),
      attendees: sarah,
      people: [SELF, SARAH],
      selfPersonId: SELF.id,
    });
    expect(close).toEqual([]);
  });
});
