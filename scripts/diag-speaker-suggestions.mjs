#!/usr/bin/env node
// Diagnostic for the suggest_speakers pipeline: reports, per audio note,
// every gate the worker checks (attendees, transcript, diarized voices,
// existing assignments, owner is_self Person) so you can see exactly where
// a recording stopped instead of guessing.
//
// Usage:
//   doppler run --project dissonance-cloud --config prd_loom -- \
//     node scripts/diag-speaker-suggestions.mjs [mediaObjectId] [--enqueue]
//
// With no id: reports the last 12 audio notes. With an id: reports just
// that note. --enqueue re-fires the suggest_speakers job for the given id
// (requires prod workers to be alive — see wake-prod-boss.mjs).
import postgres from "postgres";

const args = process.argv.slice(2);
const enqueue = args.includes("--enqueue");
const focusId = args.find((a) => !a.startsWith("--"));

const sql = postgres(process.env.DATABASE_URL, { prepare: false });

const owners = await sql`
  SELECT owner_id, count(*)::int AS total,
         count(*) FILTER (WHERE is_self)::int AS self_count,
         array_agg(display_name) FILTER (WHERE is_self) AS self_names
  FROM people GROUP BY owner_id
`;
console.log("=== people library per owner ===");
for (const p of owners) {
  const flag = p.self_count === 0 ? "  <-- GATE: no is_self Person = every run skips" : "";
  console.log(`owner=${p.owner_id} people=${p.total} is_self=${p.self_count} (${(p.self_names ?? []).join(", ")})${flag}`);
}

const notes = focusId
  ? await sql`
      SELECT m.id, m.title, m.status, m.created_at, m.attendees,
             t.provider AS transcript_provider,
             CASE WHEN t.word_timestamps IS NULL THEN 0
                  ELSE jsonb_array_length(t.word_timestamps) END AS word_count
      FROM media_objects m
      LEFT JOIN transcripts t ON t.media_object_id = m.id
      WHERE m.id = ${focusId}`
  : await sql`
      SELECT m.id, m.title, m.status, m.created_at, m.attendees,
             t.provider AS transcript_provider,
             CASE WHEN t.word_timestamps IS NULL THEN 0
                  ELSE jsonb_array_length(t.word_timestamps) END AS word_count
      FROM media_objects m
      LEFT JOIN transcripts t ON t.media_object_id = m.id
      WHERE m.type = 'audio' AND m.deleted_at IS NULL
      ORDER BY m.created_at DESC LIMIT 12`;

console.log(`\n=== ${focusId ? "note" : "last 12 audio notes"}: gate status ===`);
for (const n of notes) {
  const attCount = Array.isArray(n.attendees) ? n.attendees.length : 0;

  let speakers = [];
  if (n.word_count > 0) {
    const [s] = await sql`
      SELECT array_agg(DISTINCT (w->>'speaker')) AS speakers
      FROM transcripts t, jsonb_array_elements(t.word_timestamps) w
      WHERE t.media_object_id = ${n.id}`;
    speakers = (s.speakers || []).filter((x) => x !== null);
  }

  const assignments = await sql`
    SELECT speaker_idx, person_id, is_suggestion, suggested_at, dismissed_at,
           display_label_override, suggestion_confidence
    FROM speaker_assignments WHERE media_object_id = ${n.id}
    ORDER BY speaker_idx`;

  console.log(`\n${n.created_at.toISOString().slice(0, 16)}  ${n.id}`);
  console.log(`  title=${JSON.stringify(n.title)} status=${n.status}`);
  console.log(`  attendees=${attCount}${attCount === 0 ? "  <-- GATE: no attendees = worker skips" : ""}`);
  console.log(`  transcript provider=${n.transcript_provider} words=${n.word_count} voices=${speakers.length}${n.word_count === 0 ? "  <-- GATE: no transcript = worker skips" : ""}`);
  if (attCount > 0 && speakers.length > attCount + 1) {
    console.log(`  note: ${speakers.length} diarized voices vs ${attCount + 1} expected — over-segmented, strict match can't fire`);
  }
  if (assignments.length === 0) {
    console.log("  speaker_assignments: none");
  } else {
    for (const a of assignments) {
      const state = a.dismissed_at ? "dismissed" : a.is_suggestion ? "PENDING SUGGESTION" : "accepted/manual";
      console.log(`  idx=${a.speaker_idx} ${state} person=${a.person_id ?? a.display_label_override ?? "?"} conf=${a.suggestion_confidence ?? "-"}`);
    }
  }
}

const jobs = await sql`
  SELECT state, data, created_on, completed_on
  FROM pgboss.job WHERE name = 'suggest_speakers'
  ORDER BY created_on DESC LIMIT 10`;
console.log("\n=== recent suggest_speakers jobs ===");
for (const j of jobs) {
  console.log(`${j.created_on.toISOString().slice(0, 16)} state=${j.state} media=${j.data?.mediaObjectId}`);
}

await sql.end();

if (enqueue) {
  if (!focusId) {
    console.error("\n--enqueue requires a mediaObjectId");
    process.exit(1);
  }
  const { PgBoss } = await import("pg-boss");
  const boss = new PgBoss({ connectionString: process.env.DATABASE_URL });
  boss.on("error", (err) => console.error("[pg-boss]", err));
  await boss.start();
  await boss.createQueue("suggest_speakers");
  await boss.send("suggest_speakers", { mediaObjectId: focusId }, { retryLimit: 2, retryDelay: 30, expireInSeconds: 600 });
  console.log(`\nenqueued suggest_speakers for ${focusId}`);
  await boss.stop();
}
