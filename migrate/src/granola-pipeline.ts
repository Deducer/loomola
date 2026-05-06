// Top-level orchestrator: bootstrap → filter → fill missing transcripts
// → POST one Granola-shaped payload per note → write run state.

import { homedir } from "node:os";
import { join } from "node:path";
import { GranolaAuth } from "./granola/auth";
import { GranolaApiClient } from "./granola/api-client";
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
};

const STATE_PATH = join(homedir(), ".loomola-migrate", "state.json");

export async function runGranolaImport(
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
