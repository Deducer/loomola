// Speaker recognition v2 backfill + scorecard.
//
// DEFAULT IS A READ-ONLY DRY RUN. For every native audio note it computes
// what the v2 worker would do — speaker profile from the stored mic/system
// tracks, reconcile plan for existing speaker rows, deterministic names —
// and prints counts and ids only (never transcript text). Mic/system audio
// is decoded transiently to loudness frames; nothing is written.
//
//   doppler run --project dissonance-cloud --config prd_loom -- \
//     npx tsx scripts/backfill-speaker-v2.ts [--since 2026-07-02] [--id <mediaId>]
//
// --execute (only after the dry run has been reviewed and the v2 deploy is
// live): uploads activity.bin + sets r2_activity_key for each note, then
// enqueues suggest_speakers so the DEPLOYED worker applies the plan with
// the real code path. Accepted user rows are only ever moved/confirmed by
// capture evidence or flagged needs_review — never silently rewritten.
import postgres from "postgres";
import { computeSpeakerProfile, meSpeakerIdxs, type SpeakerProfile } from "../src/lib/speaker-profile/profile";
import { reconcileAssignments, transcriptVersionOf, type ReconcileRow } from "../src/lib/speaker-profile/reconcile";
import { composeSpeakerSuggestions } from "../src/lib/speaker-suggestion/compose";
import { parseAttendees } from "../src/lib/speaker-suggestion/parse-attendees";
import type { ActivityFrames } from "../src/lib/speaker-profile/activity";
import type { WordTimestamp } from "../src/db/queries/transcripts";
import { computeActivityFromTrackKeys, loadActivity, uploadActivity } from "../src/lib/speaker-profile/track-activity";
import { activityKeyForTrack } from "../src/lib/recording/audio-artifacts";

const args = process.argv.slice(2);
const execute = args.includes("--execute");
const argValue = (flag: string) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
const since = argValue("--since") ?? "2026-07-02";
const onlyId = argValue("--id");
const CONCURRENCY = 4;

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
  words: WordTimestamp[];
};

type Outcome = {
  id: string;
  date: string;
  status: SpeakerProfile["status"] | "error";
  micCoverage: number | null;
  voices: number;
  meIdxs: number[];
  deletes: number;
  restamps: number;
  remaps: Array<{ id: string; from: number; to: number }>;
  review: Array<{ rowId: string; speakerIdx: number; isSelf: boolean; derivation: string | null; micSaysMe: number[] }>;
  newAuto: number;
  newSuggestions: number;
  llmCandidates: number;
  acceptedSelfRows: number;
  acceptedSelfWrong: number;
  error?: string;
};

async function activityFor(n: NoteRow): Promise<ActivityFrames | null> {
  if (n.r2_activity_key) {
    const frames = await loadActivity(n.r2_activity_key);
    if (frames) return frames;
  }
  if (!n.r2_mic_key || !n.r2_systemaudio_key) return null;
  return computeActivityFromTrackKeys({ micKey: n.r2_mic_key, systemAudioKey: n.r2_systemaudio_key });
}

async function analyze(n: NoteRow, people: Map<string, Array<{ id: string; displayName: string; email: string | null; isSelf: boolean }>>): Promise<Outcome> {
  const base: Outcome = {
    id: n.id, date: n.created_at.toISOString().slice(0, 10), status: "error", micCoverage: null, voices: 0, meIdxs: [],
    deletes: 0, restamps: 0, remaps: [], review: [], newAuto: 0, newSuggestions: 0, llmCandidates: 0,
    acceptedSelfRows: 0, acceptedSelfWrong: 0,
  };
  try {
    const activity = n.provider === "deepgram-live" ? null : await activityFor(n);
    const profile = computeSpeakerProfile({ words: n.words, provider: n.provider, activity });
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
    const plan = reconcileAssignments({
      rows: reconcileRows,
      currentVersion: version,
      currentTranscriptCreatedAt: n.t_created_at,
      profile,
      selfPersonId: self?.id ?? null,
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
      newAuto: suggestions.filter((s) => s.autoApply).length,
      newSuggestions: suggestions.filter((s) => !s.autoApply).length,
      llmCandidates,
      acceptedSelfRows: acceptedSelf.length,
      acceptedSelfWrong: profile.status === "capture" ? acceptedSelf.filter((r) => !me.includes(r.speakerIdx)).length : 0,
    };
  } catch (err) {
    return { ...base, error: String((err as Error).message).slice(0, 160) };
  }
}

let v2Columns = false;

async function main() {
  const [cols] = await sql`
    SELECT count(*)::int AS n FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'speaker_assignments'
      AND column_name IN ('transcript_version', 'needs_review', 'auto_applied')`;
  v2Columns = cols.n === 3;
  if (execute && !v2Columns) {
    console.error("--execute needs migration 0034 (and the v2 worker) deployed first.");
    process.exit(1);
  }
  const notes = (await sql`
    SELECT DISTINCT ON (m.id) m.id, m.owner_id, m.created_at, m.attendees, m.r2_mic_key, m.r2_systemaudio_key,
           ${v2Columns ? sql`m.r2_activity_key` : sql`NULL::text AS r2_activity_key`}, t.provider, t.created_at AS t_created_at, t.word_timestamps AS words
    FROM media_objects m
    JOIN transcripts t ON t.media_object_id = m.id
    WHERE m.type = 'audio' AND m.deleted_at IS NULL AND m.import_source IS NULL
      AND jsonb_array_length(t.word_timestamps) > 0
      AND (${onlyId ?? null}::uuid IS NULL OR m.id = ${onlyId ?? null}::uuid)
      AND (${onlyId ?? null}::uuid IS NOT NULL OR m.created_at >= ${since})
    ORDER BY m.id, t.created_at DESC`) as unknown as NoteRow[];
  notes.sort((a, b) => b.created_at.getTime() - a.created_at.getTime());

  const peopleRows = (await sql`SELECT id, owner_id, display_name, email, is_self FROM people`) as unknown as Array<Record<string, unknown>>;
  const people = new Map<string, Array<{ id: string; displayName: string; email: string | null; isSelf: boolean }>>();
  for (const p of peopleRows) {
    const list = people.get(p.owner_id as string) ?? [];
    list.push({ id: p.id as string, displayName: p.display_name as string, email: (p.email as string | null) ?? null, isSelf: p.is_self as boolean });
    people.set(p.owner_id as string, list);
  }

  console.log(`speaker-v2 backfill ${execute ? "EXECUTE" : "DRY RUN (read-only)"} — ${notes.length} note(s) since ${onlyId ? "(single id)" : since}\n`);

  const outcomes: Outcome[] = [];
  for (let i = 0; i < notes.length; i += CONCURRENCY) {
    const batch = await Promise.all(notes.slice(i, i + CONCURRENCY).map((n) => analyze(n, people)));
    for (const o of batch) {
      outcomes.push(o);
      console.log(
        `${o.date} ${o.id.slice(0, 8)} ${o.status.padEnd(13)} cov=${o.micCoverage ?? "-"} voices=${o.voices} me=[${o.meIdxs.join(",")}]` +
          ` del=${o.deletes} keep=${o.restamps} move=${o.remaps.length} review=${o.review.length} +auto=${o.newAuto} +sugg=${o.newSuggestions} llm=${o.llmCandidates}` +
          (o.error ? ` ERROR ${o.error}` : "")
      );
    }
  }

  const sum = (f: (o: Outcome) => number) => outcomes.reduce((a, o) => a + f(o), 0);
  const byStatus: Record<string, number> = {};
  for (const o of outcomes) byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;
  const changed = outcomes.filter((o) => o.deletes + o.remaps.length + o.review.length + o.newAuto + o.newSuggestions > 0);
  console.log("\n=== summary ===");
  console.log(JSON.stringify({
    notes: outcomes.length,
    notesThatWouldChange: changed.length,
    profileStatus: byStatus,
    meFound: outcomes.filter((o) => o.meIdxs.length > 0).length,
    rowsDeletedForRecompute: sum((o) => o.deletes),
    rowsKeptConfirmed: sum((o) => o.restamps),
    rowsMoved: sum((o) => o.remaps.length),
    rowsFlaggedForReview: sum((o) => o.review.length),
    newAutoAppliedNames: sum((o) => o.newAuto),
    newSuggestions: sum((o) => o.newSuggestions),
    notesWithVoicesLeftForLlmPass: outcomes.filter((o) => o.llmCandidates > 0).length,
    acceptedSelfRowsContradictedByMic: `${sum((o) => o.acceptedSelfWrong)} of ${sum((o) => o.acceptedSelfRows)}`,
    errors: outcomes.filter((o) => o.error).length,
  }, null, 1));

  const review = outcomes.flatMap((o) => o.review.map((r) => ({ media: o.id, date: o.date, ...r })));
  console.log(`\n=== review list (${review.length} accepted row(s) the mic evidence can't vouch for; never auto-fixed) ===`);
  for (const r of review) {
    console.log(`${r.date} media=${r.media} row=${r.rowId} voice=${r.speakerIdx} ${r.isSelf ? "owner" : "other person"} derivation=${r.derivation ?? "manual"} micSaysOwnerIs=[${r.micSaysMe.join(",")}]`);
  }

  if (execute) {
    console.log("\n=== executing: activity.bin + enqueue suggest_speakers ===");
    const { PgBoss } = await import("pg-boss");
    const boss = new PgBoss({ connectionString: process.env.DATABASE_URL! });
    boss.on("error", (err: unknown) => console.error("[pg-boss]", err));
    await boss.start();
    await boss.createQueue("suggest_speakers");
    for (const n of notes) {
      if (n.provider !== "deepgram-live" && !n.r2_activity_key && n.r2_mic_key && n.r2_systemaudio_key) {
        const frames = await computeActivityFromTrackKeys({ micKey: n.r2_mic_key, systemAudioKey: n.r2_systemaudio_key });
        const key = activityKeyForTrack(n.r2_mic_key);
        await uploadActivity(key, frames);
        await sql`UPDATE media_objects SET r2_activity_key = ${key} WHERE id = ${n.id}`;
      }
      await boss.send("suggest_speakers", { mediaObjectId: n.id }, { retryLimit: 1, retryDelay: 30, expireInSeconds: 900 });
      console.log(`enqueued ${n.id}`);
    }
    await boss.stop();
  }
  await sql.end();
}

main().catch(async (err) => {
  console.error(err);
  await sql.end();
  process.exit(1);
});
