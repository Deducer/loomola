// Top-level orchestrator: bootstrap → filter → fill missing transcripts
// → POST one Granola-shaped payload per note → write run state.

import { homedir } from "node:os";
import { join } from "node:path";
import { GranolaAuth } from "./granola/auth";
import { GranolaApiClient } from "./granola/api-client";
import {
  OfficialGranolaApiClient,
  type OfficialNoteDetail,
} from "./granola/official-api-client";
import { snapshotAndReadCache } from "./granola/cache-reader";
import type {
  GranolaCacheDoc,
  GranolaCachedTranscript,
  GranolaCacheList,
} from "./granola/types";
import { proseMirrorJsonToMarkdown } from "./transform/prosemirror";
import { LoomolaApi, LoomolaApiError } from "./loomola/api-client";
import type { GranolaNoteImportPayload } from "./loomola/types";
import { RunState } from "./state/run-state";
import { logRow, logSummary, newCounter } from "./log";

export type GranolaCliArgs = {
  server: string;
  token: string;
  since: string | undefined;
  concurrency: number;
  dryRun: boolean;
  resume: boolean;
  fresh: boolean;
  retryFailed: boolean;
  // Granola Business/Enterprise API key. When set, bypass the local
  // cache and use the official REST API. When unset, fall back to
  // reading the desktop app's local cache (cache-v3/v4 plaintext only).
  granolaApiKey: string | undefined;
};

const STATE_PATH = join(homedir(), ".loomola-migrate", "state.json");

export async function runGranolaImport(
  args: GranolaCliArgs
): Promise<number> {
  if (args.granolaApiKey) {
    return runGranolaImportViaApi(args);
  }
  return runGranolaImportViaCache(args);
}

async function runGranolaImportViaCache(
  args: GranolaCliArgs
): Promise<number> {
  const start = Date.now();
  const auth = GranolaAuth.load();
  const granola = new GranolaApiClient(auth);
  const loomola = new LoomolaApi(args.server, args.token);

  // Trust the cache's self.id rather than calling /v2/get-me — the
  // reverse-engineered identity endpoint isn't always reachable, and
  // the cache is the user's authoritative local data anyway.
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const cache = snapshotAndReadCache(runId);

  let state = RunState.load(STATE_PATH);
  if (state && args.fresh) state = null;
  if (!state) {
    state = RunState.create(STATE_PATH, {
      runId,
      loomolaServer: args.server,
      granolaCacheVersion: cache.cacheVersion,
      self: { granolaId: cache.self.id, loomolaUserId: "" },
    });
  }

  let docs: GranolaCacheDoc[] = cache.documents.filter(
    (d) =>
      d.owner_id === cache.self.id &&
      !d.trashed_at &&
      (!args.since || d.created_at >= args.since)
  );

  const listsByDoc = new Map<string, GranolaCacheList[]>();
  for (const list of cache.documentLists) {
    for (const docId of list.document_ids) {
      const arr = listsByDoc.get(docId) ?? [];
      arr.push(list);
      listsByDoc.set(docId, arr);
    }
  }

  if (args.dryRun) {
    const cachedTranscriptCount = docs.filter(
      (d) => cache.transcriptsByDocId[d.id]
    ).length;
    const uniqueAttendees = new Set<string>();
    for (const d of docs) {
      for (const a of d.attendees ?? []) uniqueAttendees.add(a.id);
    }
    console.log("Plan");
    console.log(
      `  Notes to import       : ${docs.length} (filtered from ${cache.documents.length} total)`
    );
    console.log(`  Cached transcripts    : ${cachedTranscriptCount}`);
    console.log(
      `  Need fetch from Granola: ${docs.length - cachedTranscriptCount}`
    );
    console.log(`  Unique attendees      : ${uniqueAttendees.size}`);
    console.log(`  Lists → folders       : ${cache.documentLists.length}`);
    console.log(
      `  Notes already imported: ${state.data.granolaIds.succeeded.length}`
    );
    return 0;
  }

  if (args.retryFailed) {
    const failedIds = new Set(state.data.granolaIds.failed.map((f) => f.id));
    docs = docs.filter((d) => failedIds.has(d.id));
  } else if (args.resume) {
    docs = docs.filter((d) => !state!.isSucceeded(d.id));
  }

  const counter = newCounter();
  let i = 0;
  const total = docs.length;
  const queue = [...docs];
  const inflight: Promise<void>[] = [];
  let abortReason: string | null = null;

  async function processOne(d: GranolaCacheDoc): Promise<void> {
    i++;
    const local_i = i;
    const titleForLog = d.title ?? "(untitled)";
    try {
      const attendees = (d.attendees ?? []).map((a) => ({
        granolaPersonId: a.id,
        name: a.name,
        email: a.email,
        isSelf: a.id === cache.self.id,
      }));
      const lists = (listsByDoc.get(d.id) ?? []).map((l) => ({
        granolaListId: l.id,
        name: l.name,
      }));
      let transcript: GranolaCachedTranscript | null =
        cache.transcriptsByDocId[d.id] ?? null;
      if (!transcript) {
        const fetched = await granola.getDocumentTranscript(d.id);
        if (!fetched) {
          state!.markSkipped(d.id, "transcript-not-retrievable");
          // Continue: import note without transcript.
        } else {
          transcript = {
            document_id: d.id,
            segments: fetched.segments as never,
            full_text: fetched.full_text,
          };
        }
      }
      const notesBody =
        d.notes_markdown ??
        proseMirrorJsonToMarkdown(d.notes_prosemirror) ??
        d.notes_plain ??
        "";
      const payload: GranolaNoteImportPayload = {
        granolaId: d.id,
        title: d.title ?? "",
        createdAt: d.created_at,
        durationSeconds: d.duration_seconds,
        notesBody,
        aiSummary: d.summary ?? "",
        meetingUrl: d.meeting_url,
        attendees,
        lists,
        transcript: transcript
          ? {
              fullText: transcript.full_text,
              segments: transcript.segments.map((s) => ({
                granolaPersonId: s.speaker_id ?? null,
                text: s.text,
                startMs: s.start_ms,
                endMs: s.end_ms,
              })),
            }
          : null,
      };
      const result = await loomola.importGranolaNote(payload);
      state!.markSucceeded(d.id);
      if (result.action === "created") {
        counter.ok++;
        logRow(local_i, total, "ok", titleForLog, "created");
      } else if (result.action === "updated") {
        counter.upd++;
        logRow(local_i, total, "upd", titleForLog, "updated");
      } else {
        counter.upd++;
        logRow(local_i, total, "upd", titleForLog, "unchanged");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      state!.markFailed(d.id, msg);
      counter.fail++;
      logRow(local_i, total, "fail", titleForLog, msg);
      if (e instanceof LoomolaApiError && e.isAuth()) {
        abortReason =
          "Loomola token rejected. Re-reveal at /settings/migration and re-run with --resume.";
      }
    }
  }

  const max = Math.min(args.concurrency, 10);
  while ((queue.length > 0 || inflight.length > 0) && !abortReason) {
    while (queue.length > 0 && inflight.length < max && !abortReason) {
      const d = queue.shift()!;
      const p = processOne(d).finally(() => {
        const idx = inflight.indexOf(p);
        if (idx !== -1) inflight.splice(idx, 1);
      });
      inflight.push(p);
    }
    if (inflight.length > 0) await Promise.race(inflight);
  }
  // drain any remaining inflight if we aborted
  if (inflight.length > 0) await Promise.allSettled(inflight);

  state.finish();
  logSummary(counter, Date.now() - start);
  console.log(`  Logs: ${STATE_PATH}`);
  if (abortReason) {
    console.log(`\n${abortReason}`);
    return 1;
  }
  if (counter.fail > 0) {
    console.log(`  Re-run with --retry-failed to retry just those.`);
    return 1;
  }
  return 0;
}

// ─── Official-API path ─────────────────────────────────────────────────

async function runGranolaImportViaApi(
  args: GranolaCliArgs
): Promise<number> {
  const start = Date.now();
  const granola = new OfficialGranolaApiClient(args.granolaApiKey!);
  const loomola = new LoomolaApi(args.server, args.token);

  // Pull the full notes index first (cheap; one cursor walk). We need
  // the count for progress reporting + dry-run plan output.
  console.log("→ Listing notes from Granola API…");
  const notes: import("./granola/official-api-client").OfficialNoteSummary[] =
    [];
  for await (const n of granola.listAllNotes({
    pageSize: 30,
    createdAfter: args.since,
  })) {
    notes.push(n);
  }
  console.log(`  found ${notes.length} notes`);

  // State: scoped to api-mode, distinct path so cache-mode runs don't
  // collide. Using the same file for both modes is fine in practice
  // because state.granolaIds.* are just opaque ids — Granola uses the
  // same `not_*` ids in both surfaces.
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  let state = RunState.load(STATE_PATH);
  if (state && args.fresh) state = null;
  if (!state) {
    const ownerId = notes[0]?.owner.email ?? "";
    state = RunState.create(STATE_PATH, {
      runId,
      loomolaServer: args.server,
      granolaCacheVersion: 0,
      self: { granolaId: ownerId, loomolaUserId: "" },
    });
  }

  let queueable = notes.slice();
  if (args.retryFailed) {
    const failedIds = new Set(state.data.granolaIds.failed.map((f) => f.id));
    queueable = queueable.filter((n) => failedIds.has(n.id));
  } else if (args.resume) {
    queueable = queueable.filter((n) => !state!.isSucceeded(n.id));
  }

  if (args.dryRun) {
    console.log("Plan");
    console.log(`  Notes to import        : ${queueable.length}`);
    console.log(`  (Total in Granola      : ${notes.length})`);
    console.log(
      `  Notes already imported : ${state.data.granolaIds.succeeded.length}`
    );
    console.log(`  Source                 : official Granola API`);
    return 0;
  }

  const counter = newCounter();
  let i = 0;
  const total = queueable.length;
  const queue = [...queueable];
  const inflight: Promise<void>[] = [];
  let abortReason: string | null = null;

  async function processOne(
    summary: import("./granola/official-api-client").OfficialNoteSummary
  ): Promise<void> {
    i++;
    const local_i = i;
    const titleForLog = summary.title ?? "(untitled)";
    try {
      const detail = await granola.getNote(summary.id, {
        includeTranscript: true,
      });
      const payload = officialNoteToPayload(detail);
      const result = await loomola.importGranolaNote(payload);
      state!.markSucceeded(summary.id);
      if (result.action === "created") {
        counter.ok++;
        logRow(local_i, total, "ok", titleForLog, "created");
      } else if (result.action === "updated") {
        counter.upd++;
        logRow(local_i, total, "upd", titleForLog, "updated");
      } else {
        counter.upd++;
        logRow(local_i, total, "upd", titleForLog, "unchanged");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      state!.markFailed(summary.id, msg);
      counter.fail++;
      logRow(local_i, total, "fail", titleForLog, msg);
      if (e instanceof LoomolaApiError && e.isAuth()) {
        abortReason =
          "Loomola token rejected. Re-reveal at /settings/migration and re-run with --resume.";
      }
    }
  }

  const max = Math.min(args.concurrency, 10);
  while ((queue.length > 0 || inflight.length > 0) && !abortReason) {
    while (queue.length > 0 && inflight.length < max && !abortReason) {
      const n = queue.shift()!;
      const p = processOne(n).finally(() => {
        const idx = inflight.indexOf(p);
        if (idx !== -1) inflight.splice(idx, 1);
      });
      inflight.push(p);
    }
    if (inflight.length > 0) await Promise.race(inflight);
  }
  if (inflight.length > 0) await Promise.allSettled(inflight);

  state.finish();
  logSummary(counter, Date.now() - start);
  console.log(`  Logs: ${STATE_PATH}`);
  if (abortReason) {
    console.log(`\n${abortReason}`);
    return 1;
  }
  if (counter.fail > 0) {
    console.log(`  Re-run with --retry-failed to retry just those.`);
    return 1;
  }
  return 0;
}

/**
 * Map Granola's official API note response to the
 * GranolaNoteImportPayload shape the server accepts. The server
 * (already-built) handles all schema mapping; this just shapes the
 * fields.
 */
function officialNoteToPayload(
  detail: OfficialNoteDetail
): GranolaNoteImportPayload {
  // Merge attendees from the explicit list + calendar invitees,
  // dedup by email. Owner is always isSelf.
  const ownerEmail = detail.owner.email;
  const attendeesByEmail = new Map<
    string,
    { name: string; email: string; isSelf: boolean }
  >();
  for (const a of detail.attendees) {
    if (!a.email) continue;
    attendeesByEmail.set(a.email, {
      name: a.name ?? a.email,
      email: a.email,
      isSelf: a.email === ownerEmail,
    });
  }
  for (const inv of detail.calendar_event?.invitees ?? []) {
    if (!inv.email || attendeesByEmail.has(inv.email)) continue;
    attendeesByEmail.set(inv.email, {
      name: inv.email,
      email: inv.email,
      isSelf: inv.email === ownerEmail,
    });
  }
  // Always include owner even if attendees was empty.
  if (!attendeesByEmail.has(ownerEmail)) {
    attendeesByEmail.set(ownerEmail, {
      name: detail.owner.name ?? ownerEmail,
      email: ownerEmail,
      isSelf: true,
    });
  }
  const attendees = Array.from(attendeesByEmail.values()).map((a) => ({
    granolaPersonId: a.email, // email IS the stable id in the API surface
    name: a.name,
    email: a.email,
    isSelf: a.isSelf,
  }));

  // Duration: derived from calendar_event scheduled times if present,
  // otherwise null. We don't try to derive from transcript timing
  // because the meeting window can extend beyond the transcript.
  let durationSeconds: number | null = null;
  const evStart = detail.calendar_event?.scheduled_start_time;
  const evEnd = detail.calendar_event?.scheduled_end_time;
  if (evStart && evEnd) {
    const s = Date.parse(evStart);
    const e = Date.parse(evEnd);
    if (Number.isFinite(s) && Number.isFinite(e) && e > s) {
      durationSeconds = Math.round((e - s) / 1000);
    }
  }

  // Transcript normalization: map mic→owner email; speaker (system
  // audio) → null (unknown person). Convert ISO timestamps to ms
  // relative to the first segment's start_time.
  let transcript: GranolaNoteImportPayload["transcript"] = null;
  const segs = detail.transcript;
  if (segs && segs.length > 0) {
    const baseMs = Date.parse(segs[0]!.start_time);
    const safeBase = Number.isFinite(baseMs) ? baseMs : 0;
    const mapped = segs.map((s) => {
      const startMs = Math.max(0, Date.parse(s.start_time) - safeBase);
      const endMs = Math.max(startMs, Date.parse(s.end_time) - safeBase);
      return {
        granolaPersonId:
          s.speaker.source === "microphone" ? ownerEmail : null,
        text: s.text,
        startMs: Number.isFinite(startMs) ? startMs : 0,
        endMs: Number.isFinite(endMs) ? endMs : startMs,
      };
    });
    transcript = {
      segments: mapped,
      fullText: segs.map((s) => s.text).join(" ").trim(),
    };
  }

  // Body: prefer markdown summary (the polished, displayed content);
  // fall back to text-only summary; finally empty.
  const notesBody =
    detail.summary_markdown ?? detail.summary_text ?? "";

  return {
    granolaId: detail.id,
    title: detail.title ?? "",
    createdAt: detail.created_at,
    durationSeconds,
    notesBody,
    aiSummary: detail.summary_text ?? "",
    meetingUrl: null,
    attendees,
    lists: detail.folder_membership.map((f) => ({
      granolaListId: f.id,
      name: f.name,
    })),
    transcript,
  };
}
