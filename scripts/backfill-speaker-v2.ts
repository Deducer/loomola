// Speaker recognition v2 backfill + scorecard.
//
// DEFAULT IS A READ-ONLY DRY RUN. For every native audio note it computes
// what the v2 worker would do — speaker profile from the stored mic/system
// tracks, reconcile plan for existing speaker rows, deterministic names —
// and prints counts and ids only (never transcript text). Mic/system audio
// is decoded transiently to loudness frames; nothing is written.
//
//   doppler run --project dissonance-cloud --config prd_loom -- \
//     npx tsx scripts/backfill-speaker-v2.ts [--since 2026-07-02] [--id <mediaId>] [--limit N]
//
// --execute (only after the dry run has been reviewed and the v2 deploy is
// live): for each note NOT already on the v2 profile, uploads activity.bin
// (reusing the frames the analysis just decoded) and enqueues ONE
// suggest_speakers job for the DEPLOYED worker — skipped when a job for
// that note is already pending, and keyed so pg-boss drops duplicates.
// Re-running is safe: finished notes are skipped.
//
// --verify: waits for the enqueued / pending jobs to finish (20 min cap),
// prints their final states, then re-scores the same notes. With
// --execute it verifies what it just enqueued; alone, it verifies notes
// whose jobs are already in flight.
//
// Accepted user rows are only ever kept/moved by capture evidence or
// flagged needs_review by the worker — never silently rewritten.
import postgres from "postgres";
import { computeSpeakerProfile, meSpeakerIdxs, type SpeakerProfile } from "../src/lib/speaker-profile/profile";
import { reconcileAssignments, transcriptVersionOf, type ReconcileRow } from "../src/lib/speaker-profile/reconcile";
import { composeSpeakerSuggestions, dismissedDerivationsOf } from "../src/lib/speaker-suggestion/compose";
import { parseAttendees } from "../src/lib/speaker-suggestion/parse-attendees";
import type { ActivityFrames } from "../src/lib/speaker-profile/activity";
import type { WordTimestamp } from "../src/db/queries/transcripts";
import { computeActivityFromTrackKeys, loadActivity, uploadActivity } from "../src/lib/speaker-profile/track-activity";
import { activityKeyForTrack } from "../src/lib/recording/audio-artifacts";

const args = process.argv.slice(2);
const execute = args.includes("--execute");
const verify = args.includes("--verify");
const argValue = (flag: string) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
const since = argValue("--since") ?? "2026-07-02";
const onlyId = argValue("--id");
const limit = argValue("--limit") ? Number(argValue("--limit")) : undefined;
const CONCURRENCY = 4;
const DECODE_TIMEOUT_MS = 10 * 60 * 1000;
const VERIFY_TIMEOUT_MS = 20 * 60 * 1000;
const PROFILE_VERSION = 1;
const JOB = "suggest_speakers";

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, connection: { search_path: "public" } });

type NoteRow = {
  id: string;
  owner_id: string;
  created_at: Date;
  attendees: unknown;
  r2_mic_key: string | null;
  r2_systemaudio_key: string | null;
  r2_activity_key: string | null;
  provider: string;
  t_created_at: Date;
  profile_version: number | null;
  llm_status: string | null;
  words: WordTimestamp[];
};

type Outcome = {
  id: string;
  date: string;
  status: SpeakerProfile["status"] | "error";
  alreadyCurrent: boolean;
  micCoverage: number | null;
  voices: number;
  meIdxs: number[];
  deletes: number;
  restamps: number;
  remaps: Array<{ id: string; from: number; to: number }>;
  review: Array<{ rowId: string; speakerIdx: number; isSelf: boolean; derivation: string | null; micSaysMe: number[] }>;
  pendingReview: number;
  newAuto: number;
  newSuggestions: number;
  llmCandidates: number;
  acceptedSelfRows: number;
  acceptedSelfWrong: number;
  framesToUpload: ActivityFrames | null;
  error?: string;
};

let v2Columns = false;
type Person = { id: string; displayName: string; email: string | null; isSelf: boolean };

async function activityFor(n: NoteRow): Promise<{ frames: ActivityFrames | null; decoded: boolean }> {
  if (n.r2_activity_key) {
    const frames = await loadActivity(n.r2_activity_key);
    if (frames) return { frames, decoded: false };
  }
  if (!n.r2_mic_key || !n.r2_systemaudio_key) return { frames: null, decoded: false };
  const frames = await computeActivityFromTrackKeys({
    micKey: n.r2_mic_key,
    systemAudioKey: n.r2_systemaudio_key,
    timeoutMs: DECODE_TIMEOUT_MS,
  });
  return { frames, decoded: true };
}

async function analyze(n: NoteRow, people: Map<string, Person[]>): Promise<Outcome> {
  const base: Outcome = {
    id: n.id, date: n.created_at.toISOString().slice(0, 10), status: "error", alreadyCurrent: false,
    micCoverage: null, voices: 0, meIdxs: [], deletes: 0, restamps: 0, remaps: [], review: [], pendingReview: 0,
    newAuto: 0, newSuggestions: 0, llmCandidates: 0, acceptedSelfRows: 0, acceptedSelfWrong: 0, framesToUpload: null,
  };
  try {
    const { frames: activity, decoded } =
      n.provider === "deepgram-live" ? { frames: null, decoded: false } : await activityFor(n);
    const tracks = n.r2_mic_key && n.r2_systemaudio_key ? "both" : n.r2_mic_key || n.r2_systemaudio_key ? "partial" : "none";
    const profile = computeSpeakerProfile({ words: n.words, provider: n.provider, activity, tracks });
    const ownerPeople = people.get(n.owner_id) ?? [];
    const self = ownerPeople.find((p) => p.isSelf) ?? null;
    // Before migration 0034 is applied the v2 columns don't exist yet;
    // read them as their defaults so the dry run works pre-deploy.
    const rows = (v2Columns
      ? await sql`
          SELECT id, speaker_idx, person_id, is_suggestion, auto_applied, dismissed_at, needs_review,
                 transcript_version, created_at, suggested_at, suggestion_confidence
          FROM speaker_assignments WHERE media_object_id = ${n.id}`
      : await sql`
          SELECT id, speaker_idx, person_id, is_suggestion, false AS auto_applied, dismissed_at,
                 false AS needs_review, NULL::text AS transcript_version, created_at, suggested_at,
                 suggestion_confidence
          FROM speaker_assignments WHERE media_object_id = ${n.id}`) as unknown as Array<Record<string, unknown>>;
    const reconcileRows: Array<ReconcileRow & { derivation: string | null }> = rows.map((r) => ({
      id: r.id as string,
      speakerIdx: r.speaker_idx as number,
      personId: (r.person_id as string | null) ?? null,
      isSuggestion: r.is_suggestion as boolean,
      autoApplied: r.auto_applied as boolean,
      dismissedAt: (r.dismissed_at as Date | null) ?? null,
      needsReview: r.needs_review as boolean,
      transcriptVersion: (r.transcript_version as string | null) ?? null,
      createdAt: r.created_at as Date,
      suggestedAt: (r.suggested_at as Date | null) ?? null,
      derivation: (r.suggestion_confidence as string | null) ?? null,
    }));
    const version = transcriptVersionOf(n.provider, n.t_created_at);
    // The worker stores the profile in the same transaction as the names,
    // after them — so it is the completion marker for this transcript.
    // The LLM pass must have finished too ("pending" = crashed mid-run,
    // "failed" = retry it).
    const alreadyCurrent =
      n.profile_version === PROFILE_VERSION &&
      (n.llm_status === "done" || n.llm_status === "skipped") &&
      reconcileRows.every((r) => r.transcriptVersion === version);
    const plan = reconcileAssignments({
      rows: reconcileRows,
      currentVersion: version,
      currentTranscriptCreatedAt: n.t_created_at,
      profile,
      selfPersonId: self?.id ?? null,
      attendeePersonIds: parseAttendees(n.attendees)
        .map((a) => a.personId)
        .filter((id): id is string => Boolean(id) && id !== self?.id),
    });
    const me = meSpeakerIdxs(profile);

    // What survives the plan, then what the ladder would add.
    const deleted = new Set(plan.deleteIds);
    const remapTo = new Map(plan.remaps.map((r) => [r.id, r.newIdx]));
    const surviving = reconcileRows
      .filter((r) => !deleted.has(r.id))
      .map((r) => ({ ...r, speakerIdx: remapTo.get(r.id) ?? r.speakerIdx }));
    const suggestions = self
      ? composeSpeakerSuggestions({
          words: n.words,
          profile,
          attendees: parseAttendees(n.attendees),
          people: ownerPeople,
          selfPersonId: self.id,
          skipIdxs: new Set(surviving.map((r) => r.speakerIdx)),
          takenPersonIds: new Set(surviving.filter((r) => r.personId && !r.dismissedAt).map((r) => r.personId as string)),
          dismissedDerivations: dismissedDerivationsOf(
            surviving.map((r) => ({ dismissedAt: r.dismissedAt, suggestionConfidence: r.derivation }))
          ),
        })
      : [];
    const covered = new Set([...surviving.map((r) => r.speakerIdx), ...suggestions.map((s) => s.speakerIdx)]);
    const llmCandidates = profile.status === "live_channels" || parseAttendees(n.attendees).length === 0
      ? 0
      : profile.entries.filter((e) => !e.fragment && !covered.has(e.speakerIdx)).length;

    const acceptedSelf = reconcileRows.filter(
      (r) => self && r.personId === self.id && !r.isSuggestion && !r.dismissedAt
    );
    return {
      ...base,
      status: profile.status,
      alreadyCurrent,
      micCoverage: profile.micCoverage,
      voices: profile.entries.filter((e) => !e.fragment).length,
      meIdxs: me,
      deletes: plan.deleteIds.length,
      restamps: plan.restampIds.length,
      remaps: plan.remaps.map((r) => ({ id: r.id, from: reconcileRows.find((x) => x.id === r.id)!.speakerIdx, to: r.newIdx })),
      review: plan.reviewIds.map((id) => {
        const r = reconcileRows.find((x) => x.id === id)!;
        return { rowId: id, speakerIdx: r.speakerIdx, isSelf: !!self && r.personId === self.id, derivation: r.derivation, micSaysMe: me };
      }),
      pendingReview: reconcileRows.filter((r) => r.needsReview && !r.dismissedAt).length,
      newAuto: suggestions.filter((s) => s.autoApply).length,
      newSuggestions: suggestions.filter((s) => !s.autoApply).length,
      llmCandidates,
      acceptedSelfRows: acceptedSelf.length,
      acceptedSelfWrong: profile.status === "capture" ? acceptedSelf.filter((r) => !me.includes(r.speakerIdx)).length : 0,
      framesToUpload: decoded ? activity : null,
    };
  } catch (err) {
    return { ...base, error: String((err as Error).message).slice(0, 160) };
  }
}

async function loadNotes(ids?: string[]): Promise<NoteRow[]> {
  const activityCol = v2Columns ? sql`m.r2_activity_key` : sql`NULL::text AS r2_activity_key`;
  const profileCol = v2Columns
    ? sql`(t.speaker_profile->>'version')::int AS profile_version, t.speaker_profile->>'llm' AS llm_status`
    : sql`NULL::int AS profile_version, NULL::text AS llm_status`;
  const filter = ids
    ? sql`m.id = ANY(${ids}::uuid[])`
    : onlyId
      ? sql`m.id = ${onlyId}::uuid`
      : sql`m.created_at >= ${since}`;
  const notes = (await sql`
    SELECT DISTINCT ON (m.id) m.id, m.owner_id, m.created_at, m.attendees, m.r2_mic_key, m.r2_systemaudio_key,
           ${activityCol}, ${profileCol}, t.provider, t.created_at AS t_created_at, t.word_timestamps AS words
    FROM media_objects m
    JOIN transcripts t ON t.media_object_id = m.id
    WHERE m.type = 'audio' AND m.deleted_at IS NULL AND m.import_source IS NULL
      AND jsonb_array_length(t.word_timestamps) > 0
      AND ${filter}
    ORDER BY m.id, t.created_at DESC`) as unknown as NoteRow[];
  notes.sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
  return limit && !ids ? notes.slice(0, limit) : notes;
}

async function score(notes: NoteRow[], people: Map<string, Person[]>, title: string): Promise<Outcome[]> {
  console.log(`\n=== ${title} — ${notes.length} note(s) ===`);
  const outcomes: Outcome[] = [];
  for (let i = 0; i < notes.length; i += CONCURRENCY) {
    const batch = await Promise.all(notes.slice(i, i + CONCURRENCY).map((n) => analyze(n, people)));
    for (const o of batch) {
      outcomes.push(o);
      console.log(
        `${o.date} ${o.id.slice(0, 8)} ${o.status.padEnd(13)}${o.alreadyCurrent ? " [v2]" : "     "} cov=${o.micCoverage ?? "-"} voices=${o.voices} me=[${o.meIdxs.join(",")}]` +
          ` del=${o.deletes} keep=${o.restamps} move=${o.remaps.length} review=${o.review.length} +auto=${o.newAuto} +sugg=${o.newSuggestions} llm=${o.llmCandidates}` +
          (o.error ? ` ERROR ${o.error}` : "")
      );
    }
  }
  const sum = (f: (o: Outcome) => number) => outcomes.reduce((a, o) => a + f(o), 0);
  const byStatus: Record<string, number> = {};
  for (const o of outcomes) byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;
  const changed = outcomes.filter((o) => o.deletes + o.remaps.length + o.review.length + o.newAuto + o.newSuggestions > 0);
  console.log(JSON.stringify({
    notes: outcomes.length,
    alreadyOnV2: outcomes.filter((o) => o.alreadyCurrent).length,
    notesThatWouldChange: changed.length,
    profileStatus: byStatus,
    meFound: outcomes.filter((o) => o.meIdxs.length > 0).length,
    sharedMicNotes: outcomes.filter((o) => o.meIdxs.length > 1).length,
    rowsDeletedForRecompute: sum((o) => o.deletes),
    rowsKeptConfirmed: sum((o) => o.restamps),
    rowsMoved: sum((o) => o.remaps.length),
    rowsFlaggedForReview: sum((o) => o.review.length),
    rowsAlreadyNeedingReview: sum((o) => o.pendingReview),
    newAutoAppliedNames: sum((o) => o.newAuto),
    newSuggestions: sum((o) => o.newSuggestions),
    notesWithVoicesLeftForLlmPass: outcomes.filter((o) => o.llmCandidates > 0).length,
    acceptedSelfRowsContradictedByMic: `${sum((o) => o.acceptedSelfWrong)} of ${sum((o) => o.acceptedSelfRows)}`,
    errors: outcomes.filter((o) => o.error).length,
  }, null, 1));
  const review = outcomes.flatMap((o) => o.review.map((r) => ({ media: o.id, date: o.date, ...r })));
  if (review.length > 0) {
    console.log(`\nreview list (${review.length} accepted row(s) the mic evidence can't vouch for; never auto-fixed):`);
    for (const r of review) {
      console.log(`${r.date} media=${r.media} row=${r.rowId} voice=${r.speakerIdx} ${r.isSelf ? "owner" : "other person"} derivation=${r.derivation ?? "manual"} micSaysOwnerIs=[${r.micSaysMe.join(",")}]`);
    }
  }
  return outcomes;
}

async function pendingJobMediaIds(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await sql`
    SELECT DISTINCT data->>'mediaObjectId' AS id FROM pgboss.job
    WHERE name = ${JOB} AND state IN ('created', 'retry', 'active')
      AND data->>'mediaObjectId' = ANY(${ids})`;
  return new Set(rows.map((r) => r.id as string));
}

async function waitForJobs(ids: string[]): Promise<{ incomplete: number }> {
  const started = Date.now();
  let stillPending = 0;
  for (;;) {
    const pending = await pendingJobMediaIds(ids);
    if (pending.size === 0) break;
    if (Date.now() - started > VERIFY_TIMEOUT_MS) {
      console.log(`verify: gave up after ${VERIFY_TIMEOUT_MS / 60000} min with ${pending.size} job(s) still pending`);
      stillPending = pending.size;
      break;
    }
    console.log(`verify: ${pending.size} job(s) pending…`);
    await new Promise((r) => setTimeout(r, 15_000));
  }
  const states = await sql`
    SELECT DISTINCT ON (data->>'mediaObjectId') data->>'mediaObjectId' AS id, state
    FROM pgboss.job WHERE name = ${JOB} AND data->>'mediaObjectId' = ANY(${ids})
    ORDER BY data->>'mediaObjectId', created_on DESC`;
  const counts: Record<string, number> = {};
  for (const s of states) counts[s.state as string] = (counts[s.state as string] ?? 0) + 1;
  console.log(`verify: latest job state per note: ${JSON.stringify(counts)}`);
  let failed = 0;
  for (const s of states) {
    if (s.state === "failed") {
      failed++;
      console.log(`  failed: ${s.id}`);
    }
  }
  return { incomplete: stillPending + failed };
}

async function main() {
  const [cols] = await sql`
    SELECT count(*)::int AS n FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'speaker_assignments'
      AND column_name IN ('transcript_version', 'needs_review', 'auto_applied')`;
  v2Columns = cols.n === 3;
  if ((execute || verify) && !v2Columns) {
    console.error("--execute/--verify need migration 0034 (and the v2 worker) deployed first.");
    process.exit(1);
  }

  const peopleRows = (await sql`SELECT id, owner_id, display_name, email, is_self FROM people`) as unknown as Array<Record<string, unknown>>;
  const people = new Map<string, Person[]>();
  for (const p of peopleRows) {
    const list = people.get(p.owner_id as string) ?? [];
    list.push({ id: p.id as string, displayName: p.display_name as string, email: (p.email as string | null) ?? null, isSelf: p.is_self as boolean });
    people.set(p.owner_id as string, list);
  }

  const notes = await loadNotes();
  const mode = execute ? "EXECUTE" : verify ? "VERIFY" : "DRY RUN (read-only)";
  const outcomes = await score(notes, people, `speaker-v2 backfill ${mode} since ${onlyId ? "(single id)" : since}${limit ? ` (limit ${limit})` : ""}`);

  // Every selected note is verified, not just ones with a pending job: a
  // job that already failed, or a note never enqueued, is still not done.
  const toVerify = notes.map((n) => n.id);
  const analysisErrors = outcomes.filter((o) => o.error).length;
  if (analysisErrors > 0) {
    console.error(`${analysisErrors} note(s) could not be analysed (see ERROR lines above)`);
    process.exitCode = 1;
  }
  if (execute) {
    // Notes the dry run couldn't analyse are still enqueued: the worker
    // retries the decode itself, and --verify reports whether it worked.
    const todo = outcomes.filter((o) => !o.alreadyCurrent);
    const { PgBoss } = await import("pg-boss");
    const boss = new PgBoss({ connectionString: process.env.DATABASE_URL! });
    boss.on("error", (err: unknown) => console.error("[pg-boss]", err));
    await boss.start();
    await boss.createQueue(JOB);
    const pending = await pendingJobMediaIds(todo.map((o) => o.id));
    console.log(`\n=== executing: ${todo.length} note(s) not yet on v2 (${outcomes.length - todo.length} skipped), ${pending.size} already have a pending job ===`);
    for (const o of todo) {
      const n = notes.find((x) => x.id === o.id)!;
      if (o.framesToUpload && n.r2_mic_key) {
        const key = activityKeyForTrack(n.r2_mic_key);
        await uploadActivity(key, o.framesToUpload);
        await sql`UPDATE media_objects SET r2_activity_key = ${key} WHERE id = ${n.id} AND r2_activity_key IS NULL`;
      }
      if (pending.has(o.id)) {
        console.log(`pending already: ${o.id}`);
      } else {
        // singletonKey + singletonSeconds is enforced by pg-boss as a
        // unique (key, time-slot) row, so two --execute runs racing past
        // the pending check can't both enqueue the same note. The slot is
        // short so re-running after a failure isn't blocked for long.
        const jobId = await boss.send(JOB, { mediaObjectId: o.id }, {
          retryLimit: 1,
          retryDelay: 30,
          expireInSeconds: 900,
          singletonKey: `speaker-v2-backfill:${o.id}`,
          singletonSeconds: 60,
        });
        if (jobId) {
          console.log(`enqueued ${o.id}`);
        } else {
          console.log(`not enqueued (a job for this note was sent in the last minute): ${o.id}`);
        }
      }
    }
    await boss.stop();
  }

  if (verify && toVerify.length > 0) {
    console.log(`\n=== verify: waiting for ${toVerify.length} job(s) ===`);
    const { incomplete } = await waitForJobs(toVerify);
    const after = await score(await loadNotes(toVerify), people, "after backfill");
    // Done = every note now carries the v2 done-marker (profile stored in
    // the same transaction as its names) and no job failed or timed out.
    const notDone = after.filter((o) => !o.alreadyCurrent || o.error).length;
    if (incomplete > 0 || notDone > 0) {
      console.error(`verify: INCOMPLETE — ${incomplete} job(s) failed/pending, ${notDone} note(s) not on v2`);
      process.exitCode = 1;
    } else {
      console.log("verify: all notes on v2");
    }
  } else if (verify) {
    console.log("\nverify: no jobs to wait for");
  }
  await sql.end();
}

main().catch(async (err) => {
  console.error(err);
  process.exitCode = 1;
  await sql.end({ timeout: 5 }).catch(() => {});
  process.exit(1);
});
