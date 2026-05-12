#!/usr/bin/env node
// One-off diagnostic: find the most recent audio note and report its full state
// (transcript present? AI outputs? notes body length? queued jobs?).
//
// Usage:
//   doppler run --project dissonance-cloud --config prd_loom -- \
//     node scripts/diag-latest-audio.mjs

import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { prepare: false });
const focusArg = process.argv[2];

const recs = await sql`
  SELECT id, slug, title, status, created_at, updated_at,
         duration_seconds, r2_mic_key, r2_systemaudio_key, r2_mixed_key,
         folder_id, suggested_folder_id
  FROM media_objects
  WHERE type = 'audio'
    AND created_at > now() - interval '12 hours'
  ORDER BY created_at DESC
`;

console.log("=== audio notes in last 12h ===");
for (const r of recs) {
  const mins = r.duration_seconds ? (Number(r.duration_seconds)/60).toFixed(1) : 'null';
  console.log(`${r.id}  ${r.created_at.toISOString()}  status=${String(r.status).padEnd(12)} dur=${mins}min  title=${JSON.stringify(r.title)}`);
}

// Optional first arg can be either a media object id or slug. Without
// one, focus the longest recent recording because long-call failures
// are the highest-loss path this script is meant to debug.
const requested = focusArg
  ? recs.find((r) => r.id === focusArg || r.slug === focusArg)
  : null;
const longest = recs
  .filter((r) => r.duration_seconds)
  .sort((a, b) => Number(b.duration_seconds) - Number(a.duration_seconds))[0] || recs[0];
const target = longest;
const focus = requested ?? target;

if (recs.length === 0 || !focus) {
  await sql.end();
  process.exit(0);
}

console.log(`\n=== focus: ${focus.id} (${focus.slug}) ===`);
console.log(focus);

const t = await sql`
  SELECT id, provider, provider_request_id, deepgram_request_id,
         language, created_at, length(full_text) as text_len,
         left(full_text, 240) as preview,
         length(word_timestamps::text) as words_json_len
  FROM transcripts
  WHERE media_object_id = ${focus.id}
`;
console.log("\n--- transcripts ---");
console.log(t);

const ai = await sql`
  SELECT id, generation_status, generated_at,
         length(coalesce(title_suggested, '')) as title_len,
         length(coalesce(summary, '')) as summary_len,
         left(coalesce(summary, ''), 240) as summary_preview,
         template_id
  FROM ai_outputs
  WHERE media_object_id = ${focus.id}
  ORDER BY generated_at NULLS LAST
`;
console.log("\n--- ai_outputs ---");
console.log(ai);

const notes = await sql`SELECT id, length(body) as body_len, template_id, updated_at FROM notes WHERE media_object_id = ${focus.id}`;
console.log("\n--- notes ---");
console.log(notes);

// pg-boss state for this recording
const jobs = await sql`
  SELECT name, state, created_on, started_on, completed_on, retry_count, output
  FROM pgboss.job
  WHERE data::text LIKE ${'%' + focus.id + '%'}
  ORDER BY created_on DESC
  LIMIT 30
`;
console.log("\n--- pg-boss jobs (active + history table not separated here) ---");
for (const j of jobs) {
  console.log(`${j.name.padEnd(28)} ${String(j.state).padEnd(10)} created=${j.created_on?.toISOString()}  retries=${j.retry_count}  out=${j.output ? JSON.stringify(j.output).slice(0,160) : ''}`);
}

const [{ archive_table }] = await sql`
  SELECT to_regclass('pgboss.archive')::text AS archive_table
`;
if (archive_table) {
  const archive = await sql`
    SELECT name, state, created_on, completed_on, retry_count, output
    FROM pgboss.archive
    WHERE data::text LIKE ${'%' + focus.id + '%'}
    ORDER BY created_on DESC
    LIMIT 30
  `;
  console.log("\n--- pg-boss archive ---");
  for (const j of archive) {
    console.log(`${j.name.padEnd(28)} ${String(j.state).padEnd(10)} created=${j.created_on?.toISOString()}  retries=${j.retry_count}  out=${j.output ? JSON.stringify(j.output).slice(0,160) : ''}`);
  }
} else {
  console.log("\n--- pg-boss archive ---");
  console.log("(archive table not present in this pg-boss schema)");
}

await sql.end();
