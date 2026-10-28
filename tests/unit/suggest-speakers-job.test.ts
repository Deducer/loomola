import { describe, it, expect, vi, beforeEach } from "vitest";
import { framesForTurns, turns, wordsFor, type Turn } from "./fixtures/speaker-v2";
import type { ActivityFrames } from "@/lib/speaker-profile/activity";
import type { ReconcilePlan } from "@/lib/speaker-profile/reconcile";

// In-memory stand-in for the speaker-suggestion query module, so the job's
// real reconcile + ladder logic runs end to end without a database.
type Row = {
  id: string;
  speakerIdx: number;
  personId: string | null;
  isSuggestion: boolean;
  autoApplied: boolean;
  dismissedAt: Date | null;
  needsReview: boolean;
  transcriptVersion: string | null;
  createdAt: Date;
  suggestedAt: Date | null;
  suggestionConfidence: string | null;
};

const IAN = "11111111-1111-4111-8111-111111111111";
const SARAH = "22222222-2222-4222-8222-222222222222";
const ALEX = "33333333-3333-4333-8333-333333333333";

const store = vi.hoisted(() => ({
  note: null as null | Record<string, unknown>,
  rows: [] as Row[],
  currentTranscriptId: null as string | null,
  activityError: null as Error | null,
  lockError: null as Error | null,
  llmStatus: null as string | null,
  activity: null as ActivityFrames | null,
  profiles: [] as unknown[],
  nextId: 1,
}));

vi.mock("@/db/queries/speaker-suggestion", () => ({
  getNoteForSpeakerSuggestion: vi.fn(async () => store.note),
  getPeopleForSuggestion: vi.fn(async () => [
    { id: IAN, displayName: "Ian Cross", email: null, isSelf: true },
    { id: SARAH, displayName: "Sarah Chen", email: null, isSelf: false },
    { id: ALEX, displayName: "Alex Park", email: null, isSelf: false },
  ]),
  withSpeakerWriteLock: vi.fn(
    async ({ transcriptId }: { transcriptId: string }, fn: (ctx: { tx: unknown; rows: Row[]; attendees: unknown }) => Promise<unknown>) => {
      if (store.currentTranscriptId !== transcriptId) return { stale: true };
      if (store.lockError) throw store.lockError;
      return {
        stale: false,
        result: await fn({ tx: {}, rows: store.rows.map((r) => ({ ...r })), attendees: store.note?.attendees }),
      };
    }
  ),
  lockedAssignments: vi.fn(async () => store.rows.map((r) => ({ ...r }))),
  saveSpeakerProfile: vi.fn(async (_tx: unknown, _id: string, p: unknown) => {
    store.profiles.push(p);
  }),
  setActivityKey: vi.fn(async () => {}),
  setSpeakerLlmStatus: vi.fn(async (_id: string, _runId: string, status: string) => {
    store.llmStatus = status;
  }),
  applyReconcilePlan: vi.fn(async (_tx: unknown, { version, plan }: { version: string; plan: ReconcilePlan }) => {
    store.rows = store.rows.filter((r) => !plan.deleteIds.includes(r.id));
    for (const m of plan.remaps) {
      const r = store.rows.find((x) => x.id === m.id)!;
      r.speakerIdx = m.newIdx;
      r.transcriptVersion = version;
    }
    for (const id of plan.restampIds) store.rows.find((x) => x.id === id)!.transcriptVersion = version;
    for (const id of plan.reviewIds) {
      const r = store.rows.find((x) => x.id === id)!;
      r.transcriptVersion = version;
      r.needsReview = true;
      r.isSuggestion = false;
      r.autoApplied = false;
    }
  }),
  persistSpeakerSuggestions: vi.fn(
    async (_tx: unknown, { transcriptVersion, suggestions }: { transcriptVersion: string; suggestions: Array<{ speakerIdx: number; personId: string | null; autoApply: boolean; reason: string }> }) => {
      for (const s of suggestions) {
        if (store.rows.some((r) => r.speakerIdx === s.speakerIdx)) continue;
        store.rows.push({
          id: `r${store.nextId++}`,
          speakerIdx: s.speakerIdx,
          personId: s.personId,
          isSuggestion: !s.autoApply,
          autoApplied: s.autoApply,
          dismissedAt: null,
          needsReview: false,
          transcriptVersion,
          createdAt: new Date(),
          suggestedAt: new Date(),
          suggestionConfidence: s.reason,
        });
      }
    }
  ),
}));

vi.mock("@/lib/speaker-profile/track-activity", () => ({
  loadActivity: vi.fn(async () => {
    if (store.activityError) throw store.activityError;
    return store.activity;
  }),
  computeActivityFromTrackKeys: vi.fn(async () => store.activity),
  uploadActivity: vi.fn(async () => {}),
}));

const llm = vi.hoisted(() => ({
  calls: 0,
  error: null as Error | null,
  attributions: [] as unknown[],
  during: null as null | (() => void),
}));
vi.mock("@/lib/ai/with-fallback", () => ({
  generateObjectWithFallback: vi.fn(async () => {
    llm.calls++;
    llm.during?.();
    if (llm.error) throw llm.error;
    return { object: { attributions: llm.attributions } };
  }),
}));

import { runSuggestSpeakersJob } from "@/lib/queue/jobs/suggest-speakers";

const liveAt = new Date("2026-10-27T21:45:00Z");
const batchAt = new Date("2026-10-27T21:55:00Z");

function setTranscript(provider: string, createdAt: Date, t: Turn[], attendees: string[]) {
  store.note = {
    ownerId: "owner",
    type: "audio",
    attendees,
    words: wordsFor(t),
    transcriptId: `${provider}-t`,
    transcriptProvider: provider,
    transcriptCreatedAt: createdAt,
    r2MicKey: "rec/raw/mic.m4a",
    r2SystemaudioKey: "rec/raw/system.m4a",
    r2ActivityKey: "rec/activity.bin",
  };
  store.currentTranscriptId = `${provider}-t`;
}

const named = () =>
  store.rows
    .filter((r) => r.dismissedAt === null)
    .map((r) => [r.speakerIdx, r.personId, r.autoApplied ? "auto" : r.isSuggestion ? "pending" : "user", r.needsReview])
    .sort((a, b) => (a[0] as number) - (b[0] as number));

beforeEach(() => {
  store.activityError = null;
  store.lockError = null;
  store.llmStatus = null;
  store.rows = [];
  store.profiles = [];
  store.nextId = 1;
  llm.calls = 0;
  llm.error = null;
  llm.attributions = [];
  llm.during = null;
});

describe("suggest_speakers job (speaker v2)", () => {
  it("group call: the live run never names the system channel; the batch run moves Me to the mic voice", async () => {
    // Live: channel 0 = Ian's mic, channel 1 = the other participants.
    setTranscript("deepgram-live", liveAt, turns([[1, 60], [0, 20], [1, 60]]), [SARAH, ALEX]);
    store.activity = null;
    await runSuggestSpeakersJob({ mediaObjectId: "m" });
    expect(named()).toEqual([[0, IAN, "auto", false]]);
    expect(llm.calls).toBe(0);

    // Batch replaces it; diarization numbers Ian as voice 2.
    const batchTurns = turns([[0, 40], [1, 40], [2, 20], [0, 30]]);
    setTranscript("deepgram", batchAt, batchTurns, [SARAH, ALEX]);
    store.activity = framesForTurns(batchTurns, [2]);
    await runSuggestSpeakersJob({ mediaObjectId: "m" });
    expect(named()).toEqual([[2, IAN, "auto", false]]);
  });

  it("1:1 accepted during the live window: names follow their voices onto the batch transcript", async () => {
    setTranscript("deepgram-live", liveAt, turns([[0, 30], [1, 60]]), [SARAH]);
    store.activity = null;
    await runSuggestSpeakersJob({ mediaObjectId: "m" });
    // The live system channel is only suggested (it could hold extra voices).
    expect(named()).toEqual([
      [0, IAN, "auto", false],
      [1, SARAH, "pending", false],
    ]);
    // The user confirms both while the live transcript is showing.
    for (const r of store.rows) {
      r.autoApplied = false;
      r.isSuggestion = false;
    }

    // Batch numbers Sarah first — the swapped-1:1 shape.
    const batchTurns = turns([[0, 60], [1, 30], [0, 40]]);
    setTranscript("deepgram", batchAt, batchTurns, [SARAH]);
    store.activity = framesForTurns(batchTurns, [1]);
    await runSuggestSpeakersJob({ mediaObjectId: "m" });
    expect(named()).toEqual([
      [0, SARAH, "user", false],
      [1, IAN, "user", false],
    ]);
  });

  it("legacy accepted rows the mic contradicts are flagged for review, never rewritten", async () => {
    const batchTurns = turns([[0, 60], [1, 30], [0, 40]]);
    setTranscript("deepgram", batchAt, batchTurns, [SARAH]);
    store.activity = framesForTurns(batchTurns, [1]);
    const before = new Date("2026-10-27T21:46:00Z");
    store.rows = [
      { id: "a", speakerIdx: 0, personId: IAN, isSuggestion: false, autoApplied: false, dismissedAt: null, needsReview: false, transcriptVersion: null, createdAt: before, suggestedAt: before, suggestionConfidence: "self_via_source_channel" },
      { id: "b", speakerIdx: 1, personId: SARAH, isSuggestion: false, autoApplied: false, dismissedAt: null, needsReview: false, transcriptVersion: null, createdAt: before, suggestedAt: before, suggestionConfidence: "person_id_exact" },
    ];
    await runSuggestSpeakersJob({ mediaObjectId: "m" });
    expect(named()).toEqual([
      [0, IAN, "user", true],
      [1, SARAH, "user", true],
    ]);
  });

  it("stores the profile on the transcript and names nobody when the mic was dead", async () => {
    const batchTurns = turns([[0, 60], [1, 60]]);
    setTranscript("deepgram", batchAt, batchTurns, [SARAH]);
    store.activity = framesForTurns(batchTurns, [0], { silentMic: true });
    await runSuggestSpeakersJob({ mediaObjectId: "m" });
    expect(store.profiles).toHaveLength(1);
    expect((store.profiles[0] as { status: string }).status).toBe("mic_unusable");
    expect(named()).toEqual([]);
  });

  it("fails (so pg-boss retries) instead of talk-time guessing when the tracks can't be read", async () => {
    // A 1:1 where the other person talks far more — exactly where the old
    // fallback would have labeled them as the recorder.
    setTranscript("deepgram", batchAt, turns([[0, 200], [1, 20]]), [SARAH]);
    store.activityError = new Error("activity.bin fetch failed: HTTP 503");
    await expect(runSuggestSpeakersJob({ mediaObjectId: "m" })).rejects.toThrow(/503/);
    expect(store.rows).toEqual([]);
    expect(store.profiles).toEqual([]);
  });

  it("marks the LLM pass pending in the done-marker, then failed when it fails (so a backfill re-runs it)", async () => {
    // Group call: Me from the mic, two remote voices left for the LLM.
    const t = turns([[0, 40], [1, 40], [2, 40]]);
    setTranscript("deepgram", batchAt, t, [SARAH, ALEX]);
    store.activity = framesForTurns(t, [0]);
    llm.error = new Error("model overloaded");
    await expect(runSuggestSpeakersJob({ mediaObjectId: "m" })).rejects.toThrow("model overloaded");
    expect((store.profiles[0] as { llm: string }).llm).toBe("pending");
    expect(store.llmStatus).toBe("failed");
    expect(named()).toEqual([[0, IAN, "auto", false]]);
  });

  it("an LLM run made obsolete by an attendee edit writes no names and no 'done' (P2: false completion)", async () => {
    // Group call with words that let the LLM attribute voice 1 to Sarah.
    const t = turns([[0, 40], [1, 40], [2, 40]]);
    setTranscript("deepgram", batchAt, t, [SARAH, ALEX]);
    store.note!.words = (store.note!.words as Array<{ word: string; speaker: number }>).map((w, i) =>
      i === 0 ? { ...w, word: "thanks sarah for joining today" } : w
    );
    store.activity = framesForTurns(t, [0]);
    llm.attributions = [
      { speakerIdx: 1, attendeeName: "Sarah Chen", confidence: "high", evidence: "thanks sarah for joining today" },
    ];
    // While the LLM runs, the user links a different event.
    llm.during = () => {
      store.note!.attendees = [ALEX];
    };
    await runSuggestSpeakersJob({ mediaObjectId: "m" });
    expect(llm.calls).toBe(1);
    expect(store.llmStatus).toBeNull();
    expect(named().some((r) => r[1] === SARAH)).toBe(false);
  });

  it("stores the profile (the backfill's done-marker) only when the names commit", async () => {
    const batchTurns = turns([[0, 60], [1, 60]]);
    setTranscript("deepgram", batchAt, batchTurns, [SARAH]);
    store.activity = framesForTurns(batchTurns, [0]);
    store.lockError = new Error("canceling statement due to lock timeout");
    await expect(runSuggestSpeakersJob({ mediaObjectId: "m" })).rejects.toThrow(/lock timeout/);
    expect(store.profiles).toEqual([]);
  });

  it("writes nothing when the transcript was replaced while the job was computing", async () => {
    const batchTurns = turns([[0, 60], [1, 60]]);
    setTranscript("deepgram", batchAt, batchTurns, [SARAH]);
    store.activity = framesForTurns(batchTurns, [0]);
    store.currentTranscriptId = "a-newer-transcript";
    await runSuggestSpeakersJob({ mediaObjectId: "m" });
    expect(store.rows).toEqual([]);
  });

  it("is idempotent: a second run on the same transcript changes nothing", async () => {
    const batchTurns = turns([[0, 60], [1, 60]]);
    setTranscript("deepgram", batchAt, batchTurns, [SARAH]);
    store.activity = framesForTurns(batchTurns, [0]);
    await runSuggestSpeakersJob({ mediaObjectId: "m" });
    const first = named();
    await runSuggestSpeakersJob({ mediaObjectId: "m" });
    expect(named()).toEqual(first);
    expect(first).toEqual([
      [0, IAN, "auto", false],
      [1, SARAH, "auto", false],
    ]);
  });
});
