// Real-Postgres races for the suggest_speakers write path (speaker v2).
// Mocks can't show a lost update; these run the actual job and queries
// against a throwaway database:
//
//   SPEAKER_DB_TEST_URL=postgres://postgres@127.0.0.1:55439/postgres npx vitest run tests/integration/speaker-v2-db.test.ts
//
// Skipped without SPEAKER_DB_TEST_URL. Tables are created in a dedicated
// schema and dropped afterwards; never point this at a real database.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import postgres from "postgres";
import { framesForTurns, turns, wordsFor } from "../unit/fixtures/speaker-v2";
import type { ActivityFrames } from "@/lib/speaker-profile/activity";

const url = process.env.SPEAKER_DB_TEST_URL;
const SCHEMA = "speaker_v2_test";

const hooks = vi.hoisted(() => ({
  activity: null as ActivityFrames | null,
  onLoadActivity: null as null | (() => Promise<void>),
}));

vi.mock("@/lib/speaker-profile/track-activity", () => ({
  loadActivity: vi.fn(async () => {
    if (hooks.onLoadActivity) await hooks.onLoadActivity();
    return hooks.activity;
  }),
  computeActivityFromTrackKeys: vi.fn(async () => hooks.activity),
  uploadActivity: vi.fn(async () => {}),
}));
vi.mock("@/lib/ai/with-fallback", () => ({
  generateObjectWithFallback: vi.fn(async () => ({ object: { attributions: [] } })),
}));

const OWNER = "00000000-0000-4000-8000-000000000001";
const MEDIA = "00000000-0000-4000-8000-0000000000a1";
const IAN = "00000000-0000-4000-8000-0000000000b1";
const SARAH = "00000000-0000-4000-8000-0000000000b2";
const ALEX = "00000000-0000-4000-8000-0000000000b3";
const ROW = "00000000-0000-4000-8000-0000000000c1";

describe.skipIf(!url)("suggest_speakers write path against Postgres", () => {
  let admin: postgres.Sql;
  let user: postgres.Sql;
  let runSuggestSpeakersJob: typeof import("@/lib/queue/jobs/suggest-speakers").runSuggestSpeakersJob;
  let upsertSpeakerAssignment: typeof import("@/db/queries/speaker-assignments").upsertSpeakerAssignment;
  let updateAudioNoteAttendees: typeof import("@/db/queries/notes").updateAudioNoteAttendees;
  let listSpeakerAssignments: typeof import("@/db/queries/speaker-assignments").listSpeakerAssignments;
  let applySpeakerSuggestion: typeof import("@/db/queries/speaker-suggestion").applySpeakerSuggestion;
  let withSpeakerWriteLock: typeof import("@/db/queries/speaker-suggestion").withSpeakerWriteLock;

  // Sarah talks first and most; Ian (mic) is diarized as voice 1.
  const call = turns([[0, 60], [1, 30], [0, 50], [1, 20]]);

  beforeAll(async () => {
    const scoped = `${url}${url!.includes("?") ? "&" : "?"}options=-c%20search_path%3D${SCHEMA}`;
    process.env.DATABASE_URL = scoped;
    admin = postgres(url!, { onnotice: () => {} });
    await admin.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`);
    await admin.unsafe(`
      SET search_path = ${SCHEMA};
      CREATE TABLE media_objects (id uuid PRIMARY KEY, owner_id uuid NOT NULL, type text NOT NULL,
        attendees jsonb, r2_mic_key text, r2_systemaudio_key text, r2_activity_key text,
        deleted_at timestamptz, updated_at timestamptz);
      -- Real foreign keys, as in production: a transcript insert takes
      -- KEY SHARE on its note row, which is what makes lock order matter.
      CREATE TABLE transcripts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        media_object_id uuid NOT NULL REFERENCES media_objects(id) ON DELETE CASCADE,
        provider text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), word_timestamps jsonb NOT NULL,
        speaker_profile jsonb);
      CREATE TABLE people (id uuid PRIMARY KEY, owner_id uuid NOT NULL, display_name text NOT NULL,
        email text, is_self boolean NOT NULL DEFAULT false);
      CREATE TABLE speaker_assignments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        media_object_id uuid NOT NULL REFERENCES media_objects(id) ON DELETE CASCADE,
        speaker_idx integer NOT NULL, person_id uuid REFERENCES people(id) ON DELETE SET NULL,
        display_label_override text, is_suggestion boolean NOT NULL DEFAULT false,
        suggested_at timestamptz, dismissed_at timestamptz, suggested_new_person_payload jsonb,
        suggestion_confidence text, suggestion_evidence text, transcript_version text,
        needs_review boolean NOT NULL DEFAULT false, auto_applied boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (media_object_id, speaker_idx));
    `);
    user = postgres(scoped, { onnotice: () => {} });
    ({ runSuggestSpeakersJob } = await import("@/lib/queue/jobs/suggest-speakers"));
    ({ upsertSpeakerAssignment, listSpeakerAssignments } = await import("@/db/queries/speaker-assignments"));
    ({ applySpeakerSuggestion, withSpeakerWriteLock } = await import("@/db/queries/speaker-suggestion"));
    ({ updateAudioNoteAttendees } = await import("@/db/queries/notes"));
  });

  afterAll(async () => {
    await user?.end();
    await admin?.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await admin?.end();
  });

  beforeEach(async () => {
    hooks.onLoadActivity = null;
    hooks.activity = framesForTurns(call, [1]);
    await user`DELETE FROM speaker_assignments`;
    await user`DELETE FROM transcripts`;
    await user`DELETE FROM media_objects`;
    await user`DELETE FROM people`;
    await user`INSERT INTO media_objects (id, owner_id, type, attendees, r2_mic_key, r2_systemaudio_key, r2_activity_key)
      VALUES (${MEDIA}, ${OWNER}, 'audio', ${user.json([SARAH])}, 'rec/raw/mic.m4a', 'rec/raw/system.m4a', 'rec/activity.bin')`;
    await user`INSERT INTO people VALUES (${IAN}, ${OWNER}, 'Ian Cross', NULL, true),
      (${SARAH}, ${OWNER}, 'Sarah Chen', NULL, false), (${ALEX}, ${OWNER}, 'Alex Park', NULL, false)`;
    await user`INSERT INTO transcripts (media_object_id, provider, word_timestamps)
      VALUES (${MEDIA}, 'deepgram', ${user.json(wordsFor(call))})`;
  });

  const rows = () =>
    user<{ id: string; speaker_idx: number; person_id: string | null; is_suggestion: boolean }[]>`
      SELECT id, speaker_idx, person_id, is_suggestion FROM speaker_assignments ORDER BY speaker_idx`;

  it("never deletes a name the user confirms while the job is running (P1: lost update)", async () => {
    // A stale v1 suggestion from before the batch transcript: "voice 0 is Ian".
    await user`INSERT INTO speaker_assignments (id, media_object_id, speaker_idx, person_id, is_suggestion, suggested_at, created_at)
      VALUES (${ROW}, ${MEDIA}, 0, ${IAN}, true, now() - interval '1 hour', now() - interval '1 hour')`;

    // The user corrects it to Sarah; their transaction is still open when
    // the job reads the rows.
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const userTx = user.begin(async (tx) => {
      await tx`UPDATE speaker_assignments SET person_id = ${SARAH}, is_suggestion = false WHERE id = ${ROW}`;
      await held;
    });
    const job = runSuggestSpeakersJob({ mediaObjectId: MEDIA });
    await new Promise((r) => setTimeout(r, 400));
    release();
    await userTx;
    await job;

    const after = await rows();
    expect(after.find((r) => r.id === ROW)).toMatchObject({ speaker_idx: 0, person_id: SARAH, is_suggestion: false });
    // And Ian is named on the mic voice without touching the user's row.
    expect(after.find((r) => r.speaker_idx === 1)?.person_id).toBe(IAN);
  });

  it("writes nothing when the transcript is replaced while the job computes (P1: stale job)", async () => {
    hooks.onLoadActivity = async () => {
      // persistTranscript replaces the row (delete + insert) mid-job.
      await user`DELETE FROM transcripts WHERE media_object_id = ${MEDIA}`;
      await user`INSERT INTO transcripts (media_object_id, provider, word_timestamps, created_at)
        VALUES (${MEDIA}, 'deepgram', ${user.json(wordsFor(call))}, now() + interval '1 minute')`;
    };
    await runSuggestSpeakersJob({ mediaObjectId: MEDIA });
    expect(await rows()).toEqual([]);
  });

  it("names Me and the 1:1 attendee on a clean run, and a second run is a no-op", async () => {
    await runSuggestSpeakersJob({ mediaObjectId: MEDIA });
    const first = await rows();
    expect(first.map((r) => [r.speaker_idx, r.person_id, r.is_suggestion])).toEqual([
      [0, SARAH, false],
      [1, IAN, false],
    ]);
    await runSuggestSpeakersJob({ mediaObjectId: MEDIA });
    expect(await rows()).toEqual(first);
  });

  it("refuses a label made on a transcript that has since been replaced (P1: stale screen)", async () => {
    const [t] = await user<{ provider: string; created_at: Date }[]>`
      SELECT provider, created_at FROM transcripts WHERE media_object_id = ${MEDIA}`;
    const current = `${t.provider}:${t.created_at.toISOString()}`;
    // The user was looking at the live transcript (channel indices).
    await expect(
      upsertSpeakerAssignment({
        mediaObjectId: MEDIA, ownerId: OWNER, speakerIdx: 1, personId: SARAH,
        transcriptVersion: "deepgram-live:2026-10-27T21:45:00.000Z",
      })
    ).rejects.toThrow("transcript_changed");
    expect(await rows()).toEqual([]);
    // Against the transcript on screen it saves, stamped with that version.
    await upsertSpeakerAssignment({ mediaObjectId: MEDIA, ownerId: OWNER, speakerIdx: 0, personId: SARAH, transcriptVersion: current });
    const [saved] = await user`SELECT transcript_version, is_suggestion FROM speaker_assignments`;
    expect(saved).toMatchObject({ transcript_version: current, is_suggestion: false });
  });

  it("uses the attendee list current at write time, not the one the job started with (P1: attendee race)", async () => {
    hooks.onLoadActivity = async () => {
      // The user links a different calendar event while the job computes.
      await updateAudioNoteAttendees({ mediaObjectId: MEDIA, ownerId: OWNER, personIds: [ALEX] });
    };
    await runSuggestSpeakersJob({ mediaObjectId: MEDIA });
    const after = await rows();
    expect(after.find((r) => r.speaker_idx === 0)?.person_id).toBe(ALEX);
    expect(after.some((r) => r.person_id === SARAH)).toBe(false);
  });

  it("leaves no done-marker when the write fails, so a backfill retries the note (P1: completion)", async () => {
    await admin.unsafe(`
      SET search_path = ${SCHEMA};
      CREATE FUNCTION fail_insert() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'simulated write failure'; END $$ LANGUAGE plpgsql;
      CREATE TRIGGER fail_insert BEFORE INSERT ON speaker_assignments FOR EACH ROW EXECUTE FUNCTION fail_insert();`);
    try {
      await expect(runSuggestSpeakersJob({ mediaObjectId: MEDIA })).rejects.toThrow();
      const [t] = await user`SELECT speaker_profile FROM transcripts WHERE media_object_id = ${MEDIA}`;
      expect(t.speaker_profile).toBeNull();
    } finally {
      await admin.unsafe(`SET search_path = ${SCHEMA}; DROP TRIGGER fail_insert ON speaker_assignments; DROP FUNCTION fail_insert();`);
    }
  });

  const currentVersion = async () => {
    const [t] = await user<{ provider: string; created_at: Date }[]>`
      SELECT provider, created_at FROM transcripts WHERE media_object_id = ${MEDIA}`;
    return `${t.provider}:${t.created_at.toISOString()}`;
  };

  it("serializes a user's label with a worker holding the note lock (P1: user write race)", async () => {
    const shown = await currentVersion();
    await user`INSERT INTO speaker_assignments (media_object_id, speaker_idx, person_id, transcript_version)
      VALUES (${MEDIA}, 0, ${SARAH}, ${shown})`;
    // A worker holds the note lock: it moves Sarah 0→1 and the transcript
    // is replaced under it.
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const worker = user.begin(async (tx) => {
      await tx`SELECT id FROM media_objects WHERE id = ${MEDIA} FOR UPDATE`;
      await tx`UPDATE speaker_assignments SET speaker_idx = 1 WHERE media_object_id = ${MEDIA}`;
      await tx`DELETE FROM transcripts WHERE media_object_id = ${MEDIA}`;
      await tx`INSERT INTO transcripts (media_object_id, provider, word_timestamps, created_at)
        VALUES (${MEDIA}, 'deepgram', ${tx.json(wordsFor(call))}, now() + interval '1 minute')`;
      await held;
    });
    await new Promise((r) => setTimeout(r, 100));
    // The user labels voice 0 from the screen they still have open.
    const write = upsertSpeakerAssignment({
      mediaObjectId: MEDIA, ownerId: OWNER, speakerIdx: 0, personId: IAN, transcriptVersion: shown,
    });
    await new Promise((r) => setTimeout(r, 300));
    release();
    await worker;
    await expect(write).rejects.toThrow("transcript_changed");
    expect((await rows()).map((r) => [r.speaker_idx, r.person_id])).toEqual([[1, SARAH]]);
  });

  it("requires the client to say which transcript it was showing (P1: optional version)", async () => {
    // An old desktop build sends no version: it might be labeling a live
    // channel index against the batch transcript.
    await expect(
      upsertSpeakerAssignment({ mediaObjectId: MEDIA, ownerId: OWNER, speakerIdx: 0, personId: SARAH })
    ).rejects.toThrow("transcript_version_required");
    const { deleteSpeakerAssignment } = await import("@/db/queries/speaker-assignments");
    await user`INSERT INTO speaker_assignments (media_object_id, speaker_idx, person_id, transcript_version)
      VALUES (${MEDIA}, 0, ${SARAH}, ${await currentVersion()})`;
    await expect(deleteSpeakerAssignment(MEDIA, OWNER, 0, null)).rejects.toThrow("transcript_version_required");
    await expect(deleteSpeakerAssignment(MEDIA, OWNER, 0, "deepgram-live:2026-10-27T21:45:00.000Z")).rejects.toThrow(
      "transcript_changed"
    );
    expect(await rows()).toHaveLength(1);
    expect(await deleteSpeakerAssignment(MEDIA, OWNER, 0, await currentVersion())).toBe(true);
  });

  it("shows names from an older transcript as uncertain and hides stale suggestions (P1: stale reads)", async () => {
    await user`INSERT INTO speaker_assignments (media_object_id, speaker_idx, person_id, is_suggestion, transcript_version)
      VALUES (${MEDIA}, 0, ${SARAH}, false, 'deepgram-live:2026-10-27T21:45:00.000Z'),
             (${MEDIA}, 1, ${IAN}, true, 'deepgram-live:2026-10-27T21:45:00.000Z')`;
    const shown = await listSpeakerAssignments(MEDIA, OWNER);
    expect(shown.map((r) => [r.speakerIdx, r.personId, r.needsReview])).toEqual([[0, SARAH, true]]);
  });

  it("refuses to accept a suggestion computed on an older transcript (P1: stale accept)", async () => {
    await user`INSERT INTO speaker_assignments (media_object_id, speaker_idx, person_id, is_suggestion, suggested_at, created_at)
      VALUES (${MEDIA}, 1, ${IAN}, true, now() - interval '1 hour', now() - interval '1 hour')`;
    const result = await applySpeakerSuggestion({
      mediaObjectId: MEDIA, ownerId: OWNER, speakerIdx: 1, personId: IAN, transcriptVersion: await currentVersion(),
    });
    expect(result).toEqual({ ok: false, reason: "transcript_changed" });
    expect((await rows())[0].is_suggestion).toBe(true);
  });

  it("doesn't deadlock with a transcript replacement (delete, then FK insert) (P1: lock order)", async () => {
    const [old] = await user<{ id: string }[]>`SELECT id FROM transcripts WHERE media_object_id = ${MEDIA}`;
    // persistTranscript's order: delete the old row (row lock held), then
    // insert the new one (foreign key → KEY SHARE on the note row).
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const persist = user.begin(async (tx) => {
      await tx`DELETE FROM transcripts WHERE media_object_id = ${MEDIA}`;
      await held;
      await tx`INSERT INTO transcripts (media_object_id, provider, word_timestamps, created_at)
        VALUES (${MEDIA}, 'deepgram', ${tx.json(wordsFor(call))}, now() + interval '1 minute')`;
    });
    await new Promise((r) => setTimeout(r, 100));
    // The worker takes the note lock, then waits on the transcript row.
    const lock = withSpeakerWriteLock({ mediaObjectId: MEDIA, transcriptId: old.id }, async () => "wrote");
    await new Promise((r) => setTimeout(r, 300));
    release();
    await expect(persist).resolves.toBeUndefined(); // committed, not aborted as a deadlock victim
    // The worker sees its transcript is gone and writes nothing.
    await expect(lock).resolves.toEqual({ stale: true });
  });

  it("binds accept to the suggestion on that voice now, not one a client cached (P1: stale accept target)", async () => {
    const shown = await currentVersion();
    // Today the suggestion on voice 0 is Sarah; an old screen still shows
    // "voice 0: Alex?" and the user clicks Apply.
    await user`INSERT INTO speaker_assignments (media_object_id, speaker_idx, person_id, is_suggestion, transcript_version)
      VALUES (${MEDIA}, 0, ${SARAH}, true, ${shown})`;
    const result = await applySpeakerSuggestion({
      mediaObjectId: MEDIA, ownerId: OWNER, speakerIdx: 0, personId: ALEX, transcriptVersion: shown,
    });
    expect(result).toEqual({ ok: false, reason: "suggestion_changed" });
    expect((await rows())[0]).toMatchObject({ person_id: SARAH, is_suggestion: true });
    expect(
      await applySpeakerSuggestion({ mediaObjectId: MEDIA, ownerId: OWNER, speakerIdx: 0, personId: SARAH, transcriptVersion: shown })
    ).toEqual({ ok: true });
  });
});
