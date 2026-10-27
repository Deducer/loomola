import { describe, it, expect } from "vitest";
import {
  reconcileAssignments,
  transcriptVersionOf,
  type ReconcileRow,
} from "@/lib/speaker-profile/reconcile";
import { computeSpeakerProfile } from "@/lib/speaker-profile/profile";
import { framesForTurns, turns, wordsFor } from "./fixtures/speaker-v2";

const SELF = "self";
const OTHER = "other";
const liveAt = new Date("2026-08-05T21:59:00Z");
const batchAt = new Date("2026-08-05T22:15:00Z");
const LIVE = transcriptVersionOf("deepgram-live", liveAt);
const BATCH = transcriptVersionOf("deepgram", batchAt);

// Batch 1:1 where diarization numbered the OTHER person first: the
// recorder (mic) is batch speaker 1.
const oneOnOne = turns([[0, 60], [1, 40], [0, 50], [1, 30]]);
const profile1on1 = computeSpeakerProfile({
  words: wordsFor(oneOnOne),
  provider: "deepgram",
  activity: framesForTurns(oneOnOne, [1]),
});

function row(over: Partial<ReconcileRow>): ReconcileRow {
  return {
    id: "r",
    speakerIdx: 0,
    personId: null,
    isSuggestion: false,
    autoApplied: false,
    dismissedAt: null,
    needsReview: false,
    transcriptVersion: LIVE,
    createdAt: liveAt,
    suggestedAt: liveAt,
    ...over,
  };
}

const plan = (rows: ReconcileRow[], profile = profile1on1) =>
  reconcileAssignments({
    rows,
    currentVersion: BATCH,
    currentTranscriptCreatedAt: batchAt,
    profile,
    selfPersonId: SELF,
  });

describe("reconcileAssignments", () => {
  it("moves accepted live-channel names onto the voices those channels became (the swapped 1:1)", () => {
    const p = plan([
      row({ id: "me", speakerIdx: 0, personId: SELF }),
      row({ id: "them", speakerIdx: 1, personId: OTHER }),
    ]);
    expect(p.remaps).toEqual([
      { id: "me", newIdx: 1 },
      { id: "them", newIdx: 0 },
    ]);
    expect(p.reviewIds).toEqual([]);
    expect(p.deleteIds).toEqual([]);
  });

  it("deletes stale pending suggestions and stale auto-applied rows for recompute", () => {
    const p = plan([
      row({ id: "pending", speakerIdx: 1, personId: SELF, isSuggestion: true }),
      row({ id: "auto", speakerIdx: 0, personId: SELF, autoApplied: true }),
    ]);
    expect(p.deleteIds.sort()).toEqual(["auto", "pending"]);
  });

  it("always deletes legacy (unversioned) pending rows — they came from the retired v1 rules", () => {
    const p = plan([
      row({ id: "legacy", transcriptVersion: null, isSuggestion: true, suggestedAt: new Date("2026-08-06T00:00:00Z") }),
    ]);
    expect(p.deleteIds).toEqual(["legacy"]);
  });

  it("keeps a legacy accepted row the mic evidence confirms, restamping it", () => {
    const p = plan([
      row({ id: "ok", speakerIdx: 1, personId: SELF, transcriptVersion: null }),
    ]);
    expect(p.restampIds).toEqual(["ok"]);
  });

  it("flags a legacy accepted row the mic evidence contradicts — never silently fixed", () => {
    const p = plan([
      row({ id: "wrongMe", speakerIdx: 0, personId: SELF, transcriptVersion: null }),
      row({ id: "wrongThem", speakerIdx: 1, personId: OTHER, transcriptVersion: null }),
    ]);
    expect(p.reviewIds.sort()).toEqual(["wrongMe", "wrongThem"]);
    expect(p.remaps).toEqual([]);
  });

  it("treats a legacy row written after the current transcript as current", () => {
    const p = plan([
      row({ id: "fresh", speakerIdx: 0, personId: OTHER, transcriptVersion: null, createdAt: new Date("2026-08-06T09:00:00Z"), suggestedAt: null }),
    ]);
    expect(p.restampIds).toEqual(["fresh"]);
  });

  it("leaves rows already on the current version alone", () => {
    const p = plan([row({ id: "cur", transcriptVersion: BATCH, personId: SELF, speakerIdx: 0 })]);
    expect(p).toEqual({ deleteIds: [], restampIds: [], remaps: [], reviewIds: [] });
  });

  it("restamps everything across live → live snapshot re-saves", () => {
    const liveProfile = computeSpeakerProfile({ words: wordsFor(oneOnOne), provider: "deepgram-live", activity: null });
    const p = reconcileAssignments({
      rows: [row({ id: "a", speakerIdx: 0, personId: SELF }), row({ id: "b", speakerIdx: 1, isSuggestion: true })],
      currentVersion: transcriptVersionOf("deepgram-live", batchAt),
      currentTranscriptCreatedAt: batchAt,
      profile: liveProfile,
      selfPersonId: SELF,
    });
    expect(p.restampIds.sort()).toEqual(["a", "b"]);
  });

  it("flags a live system-channel name when the call has several remote voices", () => {
    const group = turns([[0, 40], [1, 40], [2, 40]]);
    const groupProfile = computeSpeakerProfile({
      words: wordsFor(group),
      provider: "deepgram",
      activity: framesForTurns(group, [2]),
    });
    const p = plan([row({ id: "them", speakerIdx: 1, personId: OTHER })], groupProfile);
    expect(p.reviewIds).toEqual(["them"]);
  });

  it("refuses a move onto a voice that keeps another row", () => {
    const p = plan([
      row({ id: "me", speakerIdx: 0, personId: SELF }),
      row({ id: "manual", speakerIdx: 1, personId: OTHER, transcriptVersion: BATCH }),
    ]);
    expect(p.remaps).toEqual([]);
    expect(p.reviewIds).toEqual(["me"]);
  });

  it("drops stale dismissals so the voice can be re-identified", () => {
    const p = plan([row({ id: "dis", dismissedAt: liveAt })]);
    expect(p.deleteIds).toEqual(["dis"]);
  });
});
