#!/usr/bin/env node
// One-off diagnostic: find the most recent audio note and report its full state
// (transcript present? AI outputs? notes body length? queued jobs?).
//
// Usage:
//   doppler run --project dissonance-cloud --config prd_loom -- \
//     node scripts/diag-latest-audio.mjs

import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL, { prepare: false });

const recs = await sql`
  SELECT id, slug, title, status, created_at, updated_at,
         duration_seconds, r2_mixed_key, r2_composite_key,
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

// pick the longest recording in the window — the 1h10m call the user is asking about
const longest = recs.filter(r => r.duration_seconds).sort((a,b) => Number(b.duration_seconds) - Number(a.duration_seconds))[0] || recs[0];
const target = longest;

if (recs.length === 0 || !target) {
  await sql.end();
  process.exit(0);
}

console.log(`\n=== focus on longest (likely the 1h10m call): ${target.id} (${target.slug}) ===`);
console.log(target);

const t = await sql`SELECT id, provider, language, created_at, length(full_text) as text_len, length(word_timestamps::text) as words_json_len FROM transcripts WHERE media_object_id = ${target.id}`;
console.log("\n--- transcripts ---");
console.log(t);

const ai = await sql`SELECT id, kind, generation_status_value, created_at, updated_at, length(content::text) as content_len, error_message FROM ai_outputs WHERE media_object_id = ${target.id} ORDER BY created_at`;
console.log("\n--- ai_outputs ---");
console.log(ai);

const notes = await sql`SELECT id, length(body) as body_len, updated_at FROM notes WHERE media_object_id = ${target.id}`;
console.log("\n--- notes ---");
console.log(notes);

// pg-boss state for this recording
const jobs = await sql`
  SELECT name, state, created_on, started_on, completed_on, retry_count, output
  FROM pgboss.job
  WHERE data::text LIKE ${'%' + target.id + '%'}
  ORDER BY created_on DESC
  LIMIT 30
`;
console.log("\n--- pg-boss jobs (active + history table not separated here) ---");
for (const j of jobs) {
  console.log(`${j.name.padEnd(28)} ${String(j.state).padEnd(10)} created=${j.created_on?.toISOString()}  retries=${j.retry_count}  out=${j.output ? JSON.stringify(j.output).slice(0,160) : ''}`);
}

const archive = await sql`
  SELECT name, state, created_on, completed_on, retry_count, output
  FROM pgboss.archive
  WHERE data::text LIKE ${'%' + target.id + '%'}
  ORDER BY created_on DESC
  LIMIT 30
`;
console.log("\n--- pg-boss archive ---");
for (const j of archive) {
  console.log(`${j.name.padEnd(28)} ${String(j.state).padEnd(10)} created=${j.created_on?.toISOString()}  retries=${j.retry_count}  out=${j.output ? JSON.stringify(j.output).slice(0,160) : ''}`);
}

await sql.end();
