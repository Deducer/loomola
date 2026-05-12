#!/usr/bin/env node
// Re-enqueue Deepgram transcription for audio notes whose transcript is
// missing or empty even though the uploaded audio source exists.
//
// Dry-run by default:
//   doppler run --project dissonance-cloud --config prd_loom -- \
//     node scripts/retry-bad-audio-transcripts.mjs
//
// Repair one note by id or slug:
//   doppler run --project dissonance-cloud --config prd_loom -- \
//     node scripts/retry-bad-audio-transcripts.mjs --apply --id <media-id-or-slug>
//
// Repair a bounded batch:
//   doppler run --project dissonance-cloud --config prd_loom -- \
//     node scripts/retry-bad-audio-transcripts.mjs --apply --limit 25

import postgres from "postgres";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { PgBoss } = require("pg-boss");

const args = new Set(process.argv.slice(2));
const argValue = (name, fallback = null) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
};

const apply = args.has("--apply");
const idOrSlug = argValue("--id");
const limit = Number(argValue("--limit", "25"));
const olderThanMinutes = Number(argValue("--older-than-minutes", "5"));

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { prepare: false });

const candidates = idOrSlug
  ? await sql`
      SELECT
        m.id,
        m.slug,
        m.title,
        m.status,
        m.r2_mixed_key,
        m.r2_mic_key,
        m.r2_systemaudio_key,
        latest_transcript.id AS transcript_id,
        COALESCE(length(trim(latest_transcript.full_text)), 0) AS transcript_text_length
      FROM media_objects m
      LEFT JOIN LATERAL (
        SELECT id, full_text
        FROM transcripts
        WHERE media_object_id = m.id
        ORDER BY created_at DESC
        LIMIT 1
      ) latest_transcript ON true
      WHERE m.type = 'audio'
        AND m.deleted_at IS NULL
        AND (m.id::text = ${idOrSlug} OR m.slug = ${idOrSlug})
        AND COALESCE(length(trim(latest_transcript.full_text)), 0) = 0
        AND COALESCE(m.r2_mixed_key, m.r2_mic_key, m.r2_systemaudio_key) IS NOT NULL
    `
  : await sql`
      SELECT
        m.id,
        m.slug,
        m.title,
        m.status,
        m.r2_mixed_key,
        m.r2_mic_key,
        m.r2_systemaudio_key,
        latest_transcript.id AS transcript_id,
        COALESCE(length(trim(latest_transcript.full_text)), 0) AS transcript_text_length
      FROM media_objects m
      LEFT JOIN LATERAL (
        SELECT id, full_text
        FROM transcripts
        WHERE media_object_id = m.id
        ORDER BY created_at DESC
        LIMIT 1
      ) latest_transcript ON true
      WHERE m.type = 'audio'
        AND m.deleted_at IS NULL
        AND m.status <> 'transcribing'
        AND m.created_at < now() - (${olderThanMinutes}::text || ' minutes')::interval
        AND COALESCE(length(trim(latest_transcript.full_text)), 0) = 0
        AND COALESCE(m.r2_mixed_key, m.r2_mic_key, m.r2_systemaudio_key) IS NOT NULL
      ORDER BY m.created_at DESC
      LIMIT ${limit}
    `;

if (candidates.length === 0) {
  console.log("no missing/empty audio transcripts found");
  await sql.end();
  process.exit(0);
}

console.log(
  `${apply ? "repairing" : "dry run:"} ${candidates.length} missing/empty audio transcript(s)`
);
for (const row of candidates) {
  const title = row.title ? ` (${row.title})` : "";
  const state = row.transcript_id ? "empty transcript" : "missing transcript";
  console.log(`  ${row.id} / ${row.slug}: ${state}, status=${row.status}${title}`);
}

if (!apply) {
  console.log("\nAdd --apply to delete the bad transcript row and re-enqueue Deepgram.");
  await sql.end();
  process.exit(0);
}

const boss = new PgBoss({ connectionString: process.env.DATABASE_URL });
boss.on("error", (e) => console.error("[pg-boss]", e));
await boss.start();
await boss.createQueue("transcribe");

for (const row of candidates) {
  const audioKey = row.r2_mixed_key ?? row.r2_mic_key ?? row.r2_systemaudio_key;
  await sql.begin(async (tx) => {
    await tx`DELETE FROM transcripts WHERE media_object_id = ${row.id}`;
    await tx`
      UPDATE media_objects
      SET status = 'transcribing'
      WHERE id = ${row.id}
    `;
  });
  await boss.send(
    "transcribe",
    { mediaObjectId: row.id, audioKey },
    { retryLimit: 3, retryDelay: 30, retryBackoff: true, expireInSeconds: 3600 }
  );
  console.log(`  ${row.id}: enqueued`);
}

await boss.stop();
await sql.end();
console.log("done");
