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

  it("rejects a move whose target is freed only by another rejected move (remap chain)", () => {
    // Voice 0 is a splinter, 1 is the recorder, 2 the sole remote voice.
    // A (live owner, idx 0) wants 0→1; B (live other, idx 1) wants 1→2,
    // but idx 2 keeps a current-version row, so B stays on 1 — and A must
    // not move onto 1 (unique-index collision).
    const chain = turns([[0, 3], [1, 50], [2, 50]]);
    const chainProfile = computeSpeakerProfile({
      words: wordsFor(chain),
      provider: "deepgram",
      activity: framesForTurns(chain, [1]),
    });
    const rows = [
      row({ id: "A", speakerIdx: 0, personId: SELF }),
      row({ id: "B", speakerIdx: 1, personId: OTHER }),
      row({ id: "C", speakerIdx: 2, personId: "third", transcriptVersion: BATCH }),
    ];
    const p = plan(rows, chainProfile);
    // Applying the plan must leave every surviving row on a unique index.
    const moved = new Map(p.remaps.map((r) => [r.id, r.newIdx]));
    const finalIdxs = rows
      .filter((r) => !p.deleteIds.includes(r.id))
      .map((r) => moved.get(r.id) ?? r.speakerIdx);
    expect(new Set(finalIdxs).size).toBe(finalIdxs.length);
    expect(p.remaps).toEqual([]);
    expect(p.reviewIds.sort()).toEqual(["A", "B"]);
  });

  it("keeps a user's dismissal across transcript replacement, moving it with its live channel", () => {
    // "Not Ian" on the live mic channel (0) → the batch mic voice is 1.
    const moved = plan([row({ id: "dis", speakerIdx: 0, dismissedAt: liveAt })]);
    expect(moved.deleteIds).toEqual([]);
    expect(moved.remaps).toEqual([{ id: "dis", newIdx: 1 }]);
    // A dismissal that can't be mapped stays put (never deleted).
    const group = turns([[0, 40], [1, 40], [2, 40]]);
    const groupProfile = computeSpeakerProfile({ words: wordsFor(group), provider: "deepgram", activity: framesForTurns(group, [2]) });
    const kept = plan([row({ id: "dis", speakerIdx: 1, dismissedAt: liveAt })], groupProfile);
    expect(kept.deleteIds).toEqual([]);
    expect(kept.restampIds).toEqual(["dis"]);
    expect(kept.reviewIds).toEqual([]);
  });
});
