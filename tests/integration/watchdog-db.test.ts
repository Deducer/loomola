// Real-Postgres check for the stuck-recording watchdog. The mocked unit
// tests can't see SQL type errors: from 2026-11-06 every production run
// failed because the abandoned-resume UPDATE wrote a text CASE into the
// media_object_status enum column (42804). This runs the actual job against
// a throwaway database:
//
//   WATCHDOG_DB_TEST_URL=postgres://postgres@127.0.0.1:55440/postgres npx vitest run tests/integration/watchdog-db.test.ts
//
// Skipped without WATCHDOG_DB_TEST_URL. Tables are created in a dedicated
// schema and dropped afterwards; never point this at a real database.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import postgres from "postgres";

const url = process.env.WATCHDOG_DB_TEST_URL;
const SCHEMA = "watchdog_test";

const mail = vi.hoisted(() => ({ sent: [] as { to: string; subject: string }[] }));
vi.mock("@/lib/mail/mailgun", () => ({
  isEmailConfigured: () => true,
  sendEmail: vi.fn(async (msg: { to: string; subject: string }) => {
    mail.sent.push(msg);
  }),
}));
vi.mock("@/lib/supabase/service", () => ({
  getSupabaseService: () => ({
    auth: { admin: { getUserById: async () => ({ data: { user: { email: "owner@example.com" } } }) } },
  }),
}));

const OWNER = "00000000-0000-4000-8000-000000000001";
const RESUME_READY = "00000000-0000-4000-8000-0000000000a1";
const RESUME_FAILED = "00000000-0000-4000-8000-0000000000a2";
const UPLOAD_STUCK = "00000000-0000-4000-8000-0000000000a3";
const TRANSCRIBE_STUCK = "00000000-0000-4000-8000-0000000000a4";
const FRESH = "00000000-0000-4000-8000-0000000000a5";

describe.skipIf(!url)("watchdog against Postgres", () => {
  let admin: postgres.Sql;
  let user: postgres.Sql;
  let runWatchdogJob: typeof import("@/lib/queue/jobs/watchdog").runWatchdogJob;

  beforeAll(async () => {
    const scoped = `${url}${url!.includes("?") ? "&" : "?"}options=-c%20search_path%3D${SCHEMA}`;
    process.env.DATABASE_URL = scoped;
    admin = postgres(url!, { onnotice: () => {} });
    await admin.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE; CREATE SCHEMA ${SCHEMA};`);
    await admin.unsafe(`
      SET search_path = ${SCHEMA};
      CREATE TYPE media_object_status AS ENUM ('uploading', 'transcribing', 'processing', 'ready', 'failed');
      CREATE TABLE media_objects (id uuid PRIMARY KEY, owner_id uuid NOT NULL, type text NOT NULL,
        slug text NOT NULL UNIQUE, title text, status media_object_status NOT NULL, failure_reason text,
        upload_metadata jsonb, deleted_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE webhook_nonces (nonce text PRIMARY KEY,
        recording_id uuid NOT NULL REFERENCES media_objects(id) ON DELETE CASCADE,
        provider text NOT NULL, issued_at timestamptz NOT NULL DEFAULT now(), consumed_at timestamptz,
        expires_at timestamptz NOT NULL);
    `);
    user = postgres(scoped, { onnotice: () => {} });
    ({ runWatchdogJob } = await import("@/lib/queue/jobs/watchdog"));
  });

  afterAll(async () => {
    await user?.end();
    await admin?.unsafe(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await admin?.end();
  });

  beforeEach(async () => {
    mail.sent.length = 0;
    await user`DELETE FROM webhook_nonces`;
    await user`DELETE FROM media_objects`;
  });

  const insert = (id: string, status: string, ageHours: number, uploadMetadata: unknown = null) =>
    user`INSERT INTO media_objects (id, owner_id, type, slug, title, status, upload_metadata, updated_at)
      VALUES (${id}, ${OWNER}, 'audio', ${id}, 'Note', ${status}::media_object_status,
        ${uploadMetadata === null ? null : user.json(uploadMetadata as never)}, now() - make_interval(hours => ${ageHours}))`;

  const statusOf = async (id: string) =>
    (await user<{ status: string; upload_metadata: unknown }[]>`
      SELECT status, upload_metadata FROM media_objects WHERE id = ${id}`)[0];

  it("restores abandoned resumes, fails stuck rows, emails once and prunes nonces", async () => {
    await insert(RESUME_READY, "uploading", 30, { resumeSegment: { previousStatus: "ready" } });
    await insert(RESUME_FAILED, "uploading", 30, { resumeSegment: { previousStatus: "failed" } });
    await insert(UPLOAD_STUCK, "uploading", 30);
    await insert(TRANSCRIBE_STUCK, "transcribing", 3);
    await insert(FRESH, "uploading", 1, { resumeSegment: { previousStatus: "ready" } });
    await user`INSERT INTO webhook_nonces (nonce, recording_id, provider, expires_at) VALUES
      ('old', ${FRESH}, 'deepgram', now() - interval '1 day'), ('live', ${FRESH}, 'deepgram', now() + interval '1 day')`;

    const total = await runWatchdogJob();

    expect(total).toBe(4);
    expect(await statusOf(RESUME_READY)).toEqual({ status: "ready", upload_metadata: null });
    expect(await statusOf(RESUME_FAILED)).toEqual({ status: "failed", upload_metadata: null });
    expect((await statusOf(UPLOAD_STUCK)).status).toBe("failed");
    expect((await statusOf(TRANSCRIBE_STUCK)).status).toBe("failed");
    expect((await statusOf(FRESH)).status).toBe("uploading");
    expect(mail.sent).toHaveLength(1);
    expect((await user`SELECT nonce FROM webhook_nonces`).map((r) => r.nonce)).toEqual(["live"]);
  });

  it("completes when nothing is stuck", async () => {
    await insert(FRESH, "ready", 48);
    await expect(runWatchdogJob()).resolves.toBe(0);
    expect(mail.sent).toHaveLength(0);
  });
});
