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
const ROW = "00000000-0000-4000-8000-0000000000c1";

describe.skipIf(!url)("suggest_speakers write path against Postgres", () => {
  let admin: postgres.Sql;
  let user: postgres.Sql;
  let runSuggestSpeakersJob: typeof import("@/lib/queue/jobs/suggest-speakers").runSuggestSpeakersJob;

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
        attendees jsonb, r2_mic_key text, r2_systemaudio_key text, r2_activity_key text);
      CREATE TABLE transcripts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), media_object_id uuid NOT NULL,
        provider text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), word_timestamps jsonb NOT NULL,
        speaker_profile jsonb);
      CREATE TABLE people (id uuid PRIMARY KEY, owner_id uuid NOT NULL, display_name text NOT NULL,
        email text, is_self boolean NOT NULL DEFAULT false);
      CREATE TABLE speaker_assignments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        media_object_id uuid NOT NULL, speaker_idx integer NOT NULL, person_id uuid,
        display_label_override text, is_suggestion boolean NOT NULL DEFAULT false,
        suggested_at timestamptz, dismissed_at timestamptz, suggested_new_person_payload jsonb,
        suggestion_confidence text, suggestion_evidence text, transcript_version text,
        needs_review boolean NOT NULL DEFAULT false, auto_applied boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (media_object_id, speaker_idx));
    `);
    user = postgres(scoped, { onnotice: () => {} });
    ({ runSuggestSpeakersJob } = await import("@/lib/queue/jobs/suggest-speakers"));
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
    await user`DELETE FROM people`;
    await user`DELETE FROM media_objects`;
    await user`INSERT INTO media_objects VALUES (${MEDIA}, ${OWNER}, 'audio', ${user.json([SARAH])},
      'rec/raw/mic.m4a', 'rec/raw/system.m4a', 'rec/activity.bin')`;
    await user`INSERT INTO people VALUES (${IAN}, ${OWNER}, 'Ian Cross', NULL, true),
      (${SARAH}, ${OWNER}, 'Sarah Chen', NULL, false)`;
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
});
