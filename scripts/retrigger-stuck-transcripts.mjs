#!/usr/bin/env node
// One-off: re-enqueue Deepgram transcription for any media_object that's
// stuck in transcribing state with no transcripts row.
//
// Use after deploying the webhook nonce migration (Phase 3 of the security
// hardening pack), since in-flight Deepgram callbacks from the pre-deploy
// code will fail at signature verification on arrival — this script retrains
// them onto the new nonce-based flow.
//
// Usage:
//   doppler run --project dissonance-cloud --config prd_loom -- \
//     node scripts/retrigger-stuck-transcripts.mjs

import postgres from "postgres";
import PgBoss from "pg-boss";

const sql = postgres(process.env.DATABASE_URL, { prepare: false });

const stuck = await sql`
  SELECT m.id, m.r2_mixed_key, m.r2_composite_key, m.type
  FROM media_objects m
  LEFT JOIN transcripts t ON t.media_object_id = m.id
  WHERE m.status = 'transcribing'
    AND t.id IS NULL
    AND m.created_at < now() - interval '5 minutes'
`;

if (stuck.length === 0) {
  console.log("no stuck transcripts found");
  await sql.end();
  process.exit(0);
}

console.log(`found ${stuck.length} stuck transcripts; re-enqueueing...`);

const boss = new PgBoss({ connectionString: process.env.DATABASE_URL });
boss.on("error", (e) => console.error("[pg-boss]", e));
await boss.start();
await boss.createQueue("transcribe");

for (const row of stuck) {
  const sourceKey = row.r2_mixed_key ?? row.r2_composite_key;
  if (!sourceKey) {
    console.warn(`  ${row.id}: no source key, skipping`);
    continue;
  }
  await boss.send(
    "transcribe",
    {
      mediaObjectId: row.id,
      audioKey: row.type === "audio" ? sourceKey : undefined,
      compositeKey: row.type === "video" ? sourceKey : undefined,
    },
    { retryLimit: 3, retryDelay: 30, retryBackoff: true, expireInSeconds: 1800 }
  );
  console.log(`  ${row.id}: enqueued`);
}

await boss.stop();
await sql.end();
console.log("done");
