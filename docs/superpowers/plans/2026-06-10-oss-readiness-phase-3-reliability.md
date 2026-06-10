# OSS Readiness Phase 3 — Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A running Loomola instance must not silently break: pg-boss workers come up at container boot (not on the first lucky enqueue), `/api/health` reports real DB + queue status, stuck recordings get flipped to `failed` with a human-readable reason within minutes-to-hours instead of sitting in `transcribing` forever, failures render in the UI with an owner-only Retry that productizes `requeue-ai-jobs.mjs` / `retrigger-stuck-transcripts.mjs`, and browser part uploads survive transient network errors.

**Architecture:** A new `failure_reason` column on `media_objects` is the single source of failure truth — written at known failure points (Deepgram 402, LLM fallback exhaustion) and by a pg-boss-scheduled watchdog that sweeps non-terminal statuses past per-state age thresholds (keyed off `updated_at`, which every status transition now bumps). The health endpoint reads queue stats with one raw SQL aggregate over `pgboss.job` plus a non-starting `getStartedBoss()` introspection export — it never wakes boss itself, which is exactly what makes it a valid probe for the boot-warm gate. Retry is a pure decision function (`no transcript → re-transcribe; transcript + video → re-run AI jobs; transcript + audio → ready`) wrapped in a thin owner-authed route. Boot-warm is one file, `src/instrumentation.ts`, landed **last** as an isolated commit.

**Tech stack:** Next.js 15.5 (instrumentation hook, stable since 15.0 — no `experimental.instrumentationHook` flag needed), pg-boss 12.16 (`schedule()`, partitioned `pgboss.job` table), Drizzle + postgres-js, Vitest (`tests/unit`, `@/` alias), sonner toasts.

**Spec:** `docs/superpowers/specs/2026-06-09-open-source-readiness-design.md` — Phase 3, items 3.1–3.6.

**⚠️ Working-tree warning:** The repo has unrelated uncommitted changes (transcript-export work: `src/lib/recordings/transcript-export.ts`, `src/app/api/recordings/[id]/transcript.md/`, `…/transcript.srt/`, `tests/unit/recording-transcript-export.test.ts`, and a **modified `src/app/recordings/[id]/edit/page.tsx`**). NEVER `git add -A` or `git add .`. Stage only the files named in each task's commit step. Task 6 modifies the edit page, which already contains unrelated unstaged hunks — before starting Task 6, check `git diff src/app/recordings/[id]/edit/page.tsx`; if the transcript-export hunks are still uncommitted, either get them committed first (ask Ian — they're his WIP) or include them untouched and say so explicitly in the commit message. Do not discard them.

**⚠️ Task ordering — boot-warm is LAST, deliberately.** Production deploys on every push to `main` (Coolify + Doppler). `src/instrumentation.ts` caused a full prod outage on 2026-05-06 (commits `94146b8` → `c094e26` → reverted in `8e5eda1`), so it is the riskiest change in this phase. Ordering everything else first means: (a) the health endpoint (Task 4) lands **before** boot-warm and becomes the observation instrument for its verification gate; (b) boot-warm ships as a **single-file commit** that is trivially revertable (`git revert <sha> && git push`) without dragging any other Phase 3 work back out; (c) its hard gate (local container run against real env) happens after all other tasks are already safely deployed, so a gate failure blocks nothing else. Tasks 1–7 are individually pushable at any point; Task 8 must complete its container gate **before** its push.

**Two known interim states, both acceptable:** (1) between Task 4 and Task 8 landing in prod, `/api/health` will truthfully report `boss.started: false` after a container restart until something enqueues — that is the bug this phase fixes, now visible instead of silent; (2) the watchdog (Task 2) only runs while boss is started, so it reaches full effectiveness when Task 8 lands.

---

### Task 1: `failure_reason` column + write reasons at known failure points

**Files:**
- Modify: `src/db/schema.ts` (one column)
- Create: `drizzle/0027_failure_reason.sql` (+ journal/snapshot via drizzle-kit)
- Modify: `src/db/queries/recordings.ts` (two helpers)
- Modify: `src/lib/queue/jobs/transcribe.ts` (Deepgram 402 reason)
- Modify: `src/lib/ai/with-fallback.ts` (add pure `describeAiFailure`)
- Modify: `src/lib/queue/jobs/generate-title-summary.ts` (record reason on failure)
- Modify: `src/db/queries/ai-outputs.ts` (clear reason on ready)
- Modify: `src/app/api/webhooks/deepgram/[recordingId]/[nonce]/[sig]/route.ts` (clear reason on audio-ready; bump `updatedAt`)
- Modify: `src/app/api/recordings/[id]/complete/route.ts` (bump `updatedAt` on the transcribing transition)
- Test: `tests/unit/ai-failure-reason.test.ts`

Design note: `recordFailureReason` writes the reason **without** flipping status and **without** bumping `updatedAt` — pg-boss may still retry the job successfully (success paths clear the reason), and the watchdog timer must keep running from the original transition. Only the watchdog (Task 2) and the already-terminal Deepgram-402 path flip status to `failed`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/ai-failure-reason.test.ts
import { describe, expect, it } from "vitest";
import { describeAiFailure } from "@/lib/ai/with-fallback";

describe("describeAiFailure", () => {
  it("names auth failures", () => {
    expect(describeAiFailure({ statusCode: 401, message: "invalid x-api-key" })).toBe(
      "AI generation failed: the AI provider rejected the API key"
    );
    expect(describeAiFailure({ statusCode: 403 })).toBe(
      "AI generation failed: the AI provider rejected the API key"
    );
  });

  it("names credit exhaustion by status code or message", () => {
    expect(describeAiFailure({ statusCode: 402 })).toBe(
      "AI generation failed: the AI provider account is out of credits"
    );
    expect(
      describeAiFailure({ statusCode: 400, message: "Your credit balance is too low" })
    ).toBe("AI generation failed: the AI provider account is out of credits");
  });

  it("names rate limits", () => {
    expect(describeAiFailure({ statusCode: 429 })).toBe(
      "AI generation failed: AI provider rate limit"
    );
  });

  it("falls back to a truncated error message", () => {
    expect(describeAiFailure(new Error("boom"))).toBe("AI generation failed: boom");
    const long = "x".repeat(300);
    expect(describeAiFailure(new Error(long)).length).toBeLessThanOrEqual(
      "AI generation failed: ".length + 200
    );
  });

  it("never throws on junk input", () => {
    expect(describeAiFailure(null)).toBe("AI generation failed");
    expect(describeAiFailure(undefined)).toBe("AI generation failed");
    expect(describeAiFailure("string error")).toBe("AI generation failed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/ai-failure-reason.test.ts`
Expected: FAIL — `describeAiFailure` is not exported.

- [ ] **Step 3: Add the column to `src/db/schema.ts`**

In `mediaObjects`, directly after the `status` line (`status: mediaObjectStatus("status").notNull(),`), add:

```typescript
  // Human-readable cause when status='failed'. Written at known failure
  // points (Deepgram 402, LLM fallback exhaustion) and by the stuck-job
  // watchdog. Cleared by every transition back to a healthy status.
  failureReason: text("failure_reason"),
```

- [ ] **Step 4: Generate the migration**

Run: `npx drizzle-kit generate --name failure_reason`
Expected: creates `drizzle/0027_failure_reason.sql` containing only:

```sql
ALTER TABLE "media_objects" ADD COLUMN "failure_reason" text;
```

plus a `drizzle/meta/0027_snapshot.json` and a new `_journal.json` entry (`idx: 27`, tag `0027_failure_reason`). **If the generated SQL contains anything other than this single ALTER** (snapshot drift), delete the generated files and instead hand-write `drizzle/0027_failure_reason.sql` with exactly the ALTER above and append to `drizzle/meta/_journal.json` (mirroring entry 26, `"when"` = current epoch ms, e.g. `1781300000000`). Then run `npm run db:migrate` against the local/dev DATABASE_URL and confirm it applies cleanly.

- [ ] **Step 5: Add the two helpers to `src/db/queries/recordings.ts`**

At the end of the file (the file already imports `db`, `mediaObjects`, `and`, `eq`, `sql`):

```typescript
/**
 * Terminal failure: flips status to 'failed' with a human-readable reason.
 * Bumps updated_at so the watchdog's "time since last transition" stays
 * meaningful. Does not overwrite an existing reason with a vaguer one —
 * callers pass the most specific reason they have.
 */
export async function setRecordingFailed(
  id: string,
  reason: string
): Promise<void> {
  await db
    .update(mediaObjects)
    .set({ status: "failed", failureReason: reason, updatedAt: sql`now()` })
    .where(eq(mediaObjects.id, id));
}

/**
 * Records WHY a job failed without flipping status — pg-boss may still
 * retry the job successfully (success paths null the reason out). updated_at
 * is deliberately NOT bumped: the watchdog measures time since the last
 * STATUS transition, and a failing-retrying job must not reset that clock.
 */
export async function recordFailureReason(
  id: string,
  reason: string
): Promise<void> {
  await db
    .update(mediaObjects)
    .set({ failureReason: reason })
    .where(eq(mediaObjects.id, id));
}
```

- [ ] **Step 6: Use it in `src/lib/queue/jobs/transcribe.ts`**

Replace the 402 catch block body (lines 64–73, the `if (isDeepgramPaymentRequiredError(err))` branch) with:

```typescript
    if (isDeepgramPaymentRequiredError(err)) {
      await setRecordingFailed(
        mediaObjectId,
        "Transcription failed: the Deepgram account has no credits (402 Payment Required)."
      );
      console.error(
        `[transcribe] Deepgram payment required for media ${mediaObjectId}; marked failed`
      );
      return;
    }
```

Add the import `import { setRecordingFailed } from "@/db/queries/recordings";` and remove the now-unused `db` / `mediaObjects` / `eq` imports **only if** nothing else in the file uses them (they are still used by `getMediaOwnerId` / `getDeepgramKeywords` — so keep them).

- [ ] **Step 7: Add `describeAiFailure` to `src/lib/ai/with-fallback.ts`**

At the end of the file:

```typescript
/**
 * Maps a provider error to a human-readable failure_reason for the
 * recording row. Pure — unit-tested. Shown to the OWNER only (dashboard
 * card / edit page); the public share page never renders it.
 */
export function describeAiFailure(err: unknown): string {
  const e = (err ?? {}) as { statusCode?: unknown; message?: unknown };
  const status = typeof e.statusCode === "number" ? e.statusCode : undefined;
  const message =
    typeof e.message === "string" && e.message.trim() ? e.message.trim() : null;

  if (status === 401 || status === 403) {
    return "AI generation failed: the AI provider rejected the API key";
  }
  if (status === 402 || (message ?? "").toLowerCase().includes("credit balance")) {
    return "AI generation failed: the AI provider account is out of credits";
  }
  if (status === 429) {
    return "AI generation failed: AI provider rate limit";
  }
  if (message) {
    return `AI generation failed: ${message.slice(0, 200)}`;
  }
  return "AI generation failed";
}
```

- [ ] **Step 8: Record the reason in `src/lib/queue/jobs/generate-title-summary.ts`**

Rename the existing `export async function runTitleSummaryJob` to `async function runTitleSummaryJobInner` (drop the `export`), and add below it:

```typescript
export async function runTitleSummaryJob(
  data: TitleSummaryJobData
): Promise<void> {
  try {
    await runTitleSummaryJobInner(data);
  } catch (err) {
    // Record WHY before rethrowing — pg-boss owns retries; if they all
    // fail, the watchdog flips status to 'failed' and this reason (not a
    // generic "stuck" message) is what the user sees.
    try {
      await recordFailureReason(data.mediaObjectId, describeAiFailure(err));
    } catch (recordErr) {
      console.error(
        `[title-summary] failed to record failure reason for ${data.mediaObjectId}:`,
        recordErr
      );
    }
    throw err;
  }
}
```

Add imports: `describeAiFailure` to the existing `@/lib/ai/with-fallback` import; `import { recordFailureReason } from "@/db/queries/recordings";`.

- [ ] **Step 9: Clear the reason on success paths**

In `src/db/queries/ai-outputs.ts`, `flipToReadyIfComplete` final update — change the `.set(...)` to:

```typescript
      .set({ status: "ready", failureReason: null, updatedAt: sql`now()` })
```

and add `sql` to the drizzle-orm import (`import { eq, sql } from "drizzle-orm";`).

In the Deepgram webhook (`src/app/api/webhooks/deepgram/[recordingId]/[nonce]/[sig]/route.ts`):
- audio-ready write (line ~124): `.set({ status: "ready", failureReason: null, updatedAt: sql`now()` })`
- processing write (line ~145): `.set({ status: "processing", updatedAt: sql`now()` })`
- add `sql` to the drizzle-orm import.

In `src/app/api/recordings/[id]/complete/route.ts`, the transcribing transition (line ~150) — add to the `.set({...})` object:

```typescript
        updatedAt: sql`now()`,
```

and add `sql` to the existing `drizzle-orm` import (`import { and, eq, sql } from "drizzle-orm";`).

(Why `updatedAt` everywhere: the watchdog in Task 2 measures "time since last status transition" via `updated_at`. Title renames also bump it — that only *delays* the watchdog, which is the safe direction.)

- [ ] **Step 10: Verify**

Run: `npx vitest run tests/unit/ai-failure-reason.test.ts && npm run typecheck && npm run test && npm run lint`
Expected: all green.

- [ ] **Step 11: Commit**

```bash
git add src/db/schema.ts drizzle/0027_failure_reason.sql drizzle/meta/_journal.json drizzle/meta/0027_snapshot.json \
  src/db/queries/recordings.ts src/lib/queue/jobs/transcribe.ts src/lib/ai/with-fallback.ts \
  src/lib/queue/jobs/generate-title-summary.ts src/db/queries/ai-outputs.ts \
  "src/app/api/webhooks/deepgram/[recordingId]/[nonce]/[sig]/route.ts" \
  "src/app/api/recordings/[id]/complete/route.ts" tests/unit/ai-failure-reason.test.ts
git commit -m "Add failure_reason column and write it at known pipeline failure points"
```

(If drizzle-kit did not emit a snapshot file, drop it from the `git add`.)

---

### Task 2: Stuck-recording watchdog (pg-boss scheduled job)

**Files:**
- Create: `src/lib/queue/jobs/watchdog.ts`
- Modify: `src/lib/queue/boss.ts` (register queue + worker + schedule)
- Test: `tests/unit/watchdog-thresholds.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/watchdog-thresholds.test.ts
import { describe, expect, it } from "vitest";
import { STUCK_THRESHOLDS, stuckReasonFor } from "@/lib/queue/jobs/watchdog";

const NOW = new Date("2026-06-10T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 60 * 60 * 1000);

describe("stuckReasonFor", () => {
  it("transcribing is stuck after 2 hours, not before", () => {
    expect(stuckReasonFor("transcribing", hoursAgo(1.9), NOW)).toBeNull();
    expect(stuckReasonFor("transcribing", hoursAgo(2.1), NOW)).toMatch(/Transcription/);
  });

  it("processing is stuck after 1 hour, not before", () => {
    expect(stuckReasonFor("processing", hoursAgo(0.9), NOW)).toBeNull();
    expect(stuckReasonFor("processing", hoursAgo(1.1), NOW)).toMatch(/AI processing/);
  });

  it("uploading is stuck after 24 hours, not before", () => {
    expect(stuckReasonFor("uploading", hoursAgo(23), NOW)).toBeNull();
    expect(stuckReasonFor("uploading", hoursAgo(25), NOW)).toMatch(/Upload/);
  });

  it("terminal states are never stuck", () => {
    expect(stuckReasonFor("ready", hoursAgo(9999), NOW)).toBeNull();
    expect(stuckReasonFor("failed", hoursAgo(9999), NOW)).toBeNull();
  });

  it("threshold table covers exactly the three non-terminal states", () => {
    expect(STUCK_THRESHOLDS.map((t) => t.status).sort()).toEqual([
      "processing",
      "transcribing",
      "uploading",
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/watchdog-thresholds.test.ts`
Expected: FAIL — cannot resolve `@/lib/queue/jobs/watchdog`.

- [ ] **Step 3: Create `src/lib/queue/jobs/watchdog.ts`**

```typescript
import { db } from "@/db";
import { mediaObjects } from "@/db/schema";
import { and, eq, isNull, lt, sql } from "drizzle-orm";

export const WATCHDOG_JOB = "watchdog_stuck_recordings";
export const WATCHDOG_CRON = "*/10 * * * *"; // every 10 minutes

export type StuckThreshold = {
  status: "uploading" | "transcribing" | "processing";
  maxAgeMs: number;
  reason: string;
};

/**
 * Per-state age limits, measured from updated_at (bumped on every status
 * transition since Phase 3 Task 1). Deepgram async jobs land in minutes;
 * 2h of 'transcribing' means the callback is never coming (lost webhook,
 * dead workers at submit time, expired presign). 'processing' is 3 LLM
 * jobs with retryLimit 3 / 30s backoff — done or dead inside an hour.
 * 'uploading' rows are abandoned browser tabs; 24h is generous.
 */
export const STUCK_THRESHOLDS: StuckThreshold[] = [
  {
    status: "transcribing",
    maxAgeMs: 2 * 60 * 60 * 1000,
    reason: "Transcription did not complete within 2 hours.",
  },
  {
    status: "processing",
    maxAgeMs: 60 * 60 * 1000,
    reason: "AI processing did not complete within 1 hour.",
  },
  {
    status: "uploading",
    maxAgeMs: 24 * 60 * 60 * 1000,
    reason: "Upload never completed.",
  },
];

/** Pure: returns the failure reason if a row in `status` whose last
 * transition was `lastTransitionAt` counts as stuck at `now`, else null. */
export function stuckReasonFor(
  status: string,
  lastTransitionAt: Date,
  now: Date
): string | null {
  const threshold = STUCK_THRESHOLDS.find((t) => t.status === status);
  if (!threshold) return null;
  const age = now.getTime() - lastTransitionAt.getTime();
  return age > threshold.maxAgeMs ? threshold.reason : null;
}

/**
 * Marks recordings stuck in non-terminal states as failed. coalesce keeps
 * a more specific reason written at the point of failure (e.g. the LLM
 * credit message from generate-title-summary) over the generic stuck one.
 * Runs every 10 minutes via boss.schedule — see boss.ts.
 */
export async function runWatchdogJob(now: Date = new Date()): Promise<number> {
  let total = 0;
  for (const threshold of STUCK_THRESHOLDS) {
    const cutoff = new Date(now.getTime() - threshold.maxAgeMs);
    const rows = await db
      .update(mediaObjects)
      .set({
        status: "failed",
        failureReason: sql`coalesce(${mediaObjects.failureReason}, ${threshold.reason})`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(mediaObjects.status, threshold.status),
          isNull(mediaObjects.deletedAt),
          lt(mediaObjects.updatedAt, cutoff)
        )
      )
      .returning({ id: mediaObjects.id });
    for (const row of rows) {
      console.warn(
        `[watchdog] ${row.id}: stuck in '${threshold.status}' past ${Math.round(
          threshold.maxAgeMs / 60_000
        )}min — marked failed`
      );
    }
    total += rows.length;
  }
  return total;
}
```

- [ ] **Step 4: Register in `src/lib/queue/boss.ts`**

Add the import (with the other job imports at the top):

```typescript
import { WATCHDOG_JOB, WATCHDOG_CRON, runWatchdogJob } from "./jobs/watchdog";
```

In `init()`, after `await boss.createQueue(APPEND_CLIP_JOB);` add:

```typescript
  await boss.createQueue(WATCHDOG_JOB);
```

After the `SUGGEST_SPEAKERS_JOB` work registration (before the `if (granolaEnabled)` worker block) add:

```typescript
  await boss.work(WATCHDOG_JOB, async () => {
    await runWatchdogJob();
  });
  // Cron registration is an idempotent upsert in pg-boss v12 — safe on
  // every boot. UTC: thresholds are relative ages, tz is cosmetic.
  await boss.schedule(WATCHDOG_JOB, WATCHDOG_CRON, null, { tz: "UTC" });
```

Update the final queue-count log line from `${granolaEnabled ? 12 : 8}` to `${granolaEnabled ? 13 : 9}`.

- [ ] **Step 5: Verify**

Run: `npx vitest run tests/unit/watchdog-thresholds.test.ts && npm run typecheck && npm run test && npm run lint`
Expected: all green.

Manual sanity (optional but cheap, against dev DB): `npm run dev`, hit any enqueue-touching endpoint once to start boss, then `psql $DATABASE_URL -c "select name, cron from pgboss.schedule"` → one row `watchdog_stuck_recordings | */10 * * * *`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/queue/jobs/watchdog.ts src/lib/queue/boss.ts tests/unit/watchdog-thresholds.test.ts
git commit -m "Add stuck-recording watchdog as a pg-boss scheduled job"
```

---

### Task 3: Shared API error helper + replace the remaining alert()

**Files:**
- Create: `src/lib/api/error.ts`
- Modify: `src/components/viewer/comment-item.tsx` (alert → toast)
- Test: `tests/unit/api-error.test.ts`

Note: the spec says "replace the two `alert()` calls" — a repo-wide grep shows only **one** remains (`src/components/viewer/comment-item.tsx:55`); the other was already converted to sonner in earlier work. Adoption of the wrapper is deliberately limited to routes this phase creates/touches (the retry route in Task 5); no drive-by refactors.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/api-error.test.ts
import { describe, expect, it, vi } from "vitest";
import { apiError, withApiErrorHandling } from "@/lib/api/error";

describe("apiError", () => {
  it("returns the standard shape", async () => {
    const res = apiError(404, "not_found", "Recording not found");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: "not_found",
      message: "Recording not found",
    });
  });
});

describe("withApiErrorHandling", () => {
  const req = new Request("http://localhost/api/test");

  it("passes successful responses through untouched", async () => {
    const handler = withApiErrorHandling(async () => Response.json({ ok: true }));
    const res = await handler(req, { params: Promise.resolve({}) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("converts thrown errors to a generic 500 without leaking internals", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = withApiErrorHandling(async () => {
      throw new Error("postgres password is hunter2");
    });
    const res = await handler(req, { params: Promise.resolve({}) });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("internal_error");
    expect(JSON.stringify(body)).not.toContain("hunter2");
    expect(spy).toHaveBeenCalled(); // ...but it IS logged server-side
    spy.mockRestore();
  });

  it("rethrows Next.js control-flow errors (redirect from requireAuth)", async () => {
    const redirectErr = Object.assign(new Error("NEXT_REDIRECT"), {
      digest: "NEXT_REDIRECT;replace;/login;307;",
    });
    const handler = withApiErrorHandling(async () => {
      throw redirectErr;
    });
    await expect(handler(req, { params: Promise.resolve({}) })).rejects.toBe(
      redirectErr
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/api-error.test.ts`
Expected: FAIL — cannot resolve `@/lib/api/error`.

- [ ] **Step 3: Create `src/lib/api/error.ts`**

```typescript
/**
 * Shared API error helpers (spec 3.6). Plain Response (NextResponse extends
 * it) so this module stays framework-light and trivially unit-testable.
 *
 * Shape: { error: <machine code>, message: <human text> } — matches the
 * dominant existing convention (e.g. complete/route.ts "multipart_complete_failed").
 */
export function apiError(
  status: number,
  code: string,
  message: string
): Response {
  return Response.json({ error: code, message }, { status });
}

/** Next.js signals redirect()/notFound() by THROWING tagged errors. The
 * wrapper must let those propagate or requireAuth's login redirect breaks. */
function isNextControlFlowError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const digest = (err as { digest?: unknown }).digest;
  return (
    typeof digest === "string" &&
    (digest.startsWith("NEXT_REDIRECT") ||
      digest.startsWith("NEXT_HTTP_ERROR_FALLBACK") ||
      digest === "NEXT_NOT_FOUND")
  );
}

/**
 * Wraps a route handler: unexpected throws become a logged, generic 500 —
 * no stack traces or internal messages in the response body.
 */
export function withApiErrorHandling<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response>
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    try {
      return await handler(...args);
    } catch (err) {
      if (isNextControlFlowError(err)) throw err;
      console.error("[api] unhandled route error:", err);
      return apiError(
        500,
        "internal_error",
        "Something went wrong. Try again, or check the server logs."
      );
    }
  };
}
```

- [ ] **Step 4: Replace the alert in `src/components/viewer/comment-item.tsx`**

Add `import { toast } from "sonner";` and change line 55 from:

```typescript
        alert(`Delete failed (${res.status}).`);
```

to:

```typescript
        toast.error(`Delete failed (${res.status}).`);
```

- [ ] **Step 5: Verify**

Run: `npx vitest run tests/unit/api-error.test.ts && npm run typecheck && npm run test && npm run lint`
Expected: all green. Also: `grep -rn "alert(" src | grep -v Alert` → no hits.

- [ ] **Step 6: Commit**

```bash
git add src/lib/api/error.ts src/components/viewer/comment-item.tsx tests/unit/api-error.test.ts
git commit -m "Add shared API error helpers; replace last alert() with a toast"
```

---

### Task 4: Real `/api/health`

**Files:**
- Modify: `src/lib/queue/boss.ts` (one introspection export)
- Create: `src/lib/health/payload.ts`
- Modify: `src/app/api/health/route.ts` (whole file)
- Test: `tests/unit/health-payload.test.ts`

Design notes: (a) the endpoint **must never start boss** — `getStartedBoss()` reads the singleton without triggering `init()`; that's what makes `/api/health` a valid no-side-effect probe for Task 8's gate. (b) Queue stats come from one aggregate over `pgboss.job` (pg-boss v12 keeps jobs there until archival, completed/failed included for ~the retention window) — `boss.getQueues()` exists but lacks failed counts and pending age, and requires a started boss. (c) Payload is non-sensitive by construction (queue names + integer counts + short commit hash); the route is public via the exact-path middleware allowlist (`src/lib/supabase/middleware.ts:33`). (d) `status: "degraded"` still returns **200** so Coolify/compose healthchecks don't flap; **503 only when the DB is down**, and that fallback body keeps the bare legacy keys (`status`, `ts`).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/health-payload.test.ts
import { describe, expect, it } from "vitest";
import { buildHealthPayload } from "@/lib/health/payload";

const QUEUE = {
  name: "transcribe",
  pending: 0,
  active: 0,
  failed: 0,
  oldestPendingSec: null as number | null,
};

describe("buildHealthPayload", () => {
  it("ok: db up, boss started, queues healthy → 200", () => {
    const { body, httpStatus } = buildHealthPayload({
      dbOk: true,
      bossStarted: true,
      queues: [QUEUE],
      commit: "abc1234",
    });
    expect(httpStatus).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.db).toBe("ok");
    expect(body.boss).toEqual({ started: true, queues: [QUEUE] });
    expect(body.commit).toBe("abc1234");
  });

  it("degraded (still 200) when boss has not started", () => {
    const { body, httpStatus } = buildHealthPayload({
      dbOk: true,
      bossStarted: false,
      queues: [],
      commit: "abc1234",
    });
    expect(httpStatus).toBe(200);
    expect(body.status).toBe("degraded");
  });

  it("degraded when a queue has failed jobs", () => {
    const { body } = buildHealthPayload({
      dbOk: true,
      bossStarted: true,
      queues: [{ ...QUEUE, failed: 2 }],
      commit: "abc1234",
    });
    expect(body.status).toBe("degraded");
  });

  it("degraded when the oldest pending job exceeds 10 minutes", () => {
    const fresh = buildHealthPayload({
      dbOk: true,
      bossStarted: true,
      queues: [{ ...QUEUE, pending: 1, oldestPendingSec: 30 }],
      commit: "c",
    });
    expect(fresh.body.status).toBe("ok");
    const stale = buildHealthPayload({
      dbOk: true,
      bossStarted: true,
      queues: [{ ...QUEUE, pending: 1, oldestPendingSec: 700 }],
      commit: "c",
    });
    expect(stale.body.status).toBe("degraded");
  });

  it("down: db unreachable → 503 with empty queue info", () => {
    const { body, httpStatus } = buildHealthPayload({
      dbOk: false,
      bossStarted: false,
      queues: [],
      commit: "abc1234",
    });
    expect(httpStatus).toBe(503);
    expect(body.status).toBe("down");
    expect(body.db).toBe("down");
    expect(typeof body.ts).toBe("string"); // legacy key preserved
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/health-payload.test.ts`
Expected: FAIL — cannot resolve `@/lib/health/payload`.

- [ ] **Step 3: Create `src/lib/health/payload.ts`**

```typescript
// Pure assembly of the /api/health response. Payload must stay
// NON-SENSITIVE: the endpoint is public (middleware allowlists the exact
// path). Queue names, integer counts, and the short build commit only.

export type QueueHealth = {
  name: string;
  pending: number;
  active: number;
  failed: number;
  oldestPendingSec: number | null;
};

export type HealthPayload = {
  status: "ok" | "degraded" | "down";
  ts: string;
  commit: string;
  db: "ok" | "down";
  boss: { started: boolean; queues: QueueHealth[] };
};

/** A pending job older than this means workers aren't keeping up (or
 * aren't running) — degraded, not down: the app still serves traffic. */
const STALE_PENDING_SEC = 10 * 60;

export function buildHealthPayload(input: {
  dbOk: boolean;
  bossStarted: boolean;
  queues: QueueHealth[];
  commit: string;
  now?: Date;
}): { body: HealthPayload; httpStatus: number } {
  const ts = (input.now ?? new Date()).toISOString();

  if (!input.dbOk) {
    return {
      body: {
        status: "down",
        ts,
        commit: input.commit,
        db: "down",
        boss: { started: input.bossStarted, queues: [] },
      },
      httpStatus: 503,
    };
  }

  const degraded =
    !input.bossStarted ||
    input.queues.some(
      (q) => q.failed > 0 || (q.oldestPendingSec ?? 0) > STALE_PENDING_SEC
    );

  return {
    body: {
      status: degraded ? "degraded" : "ok",
      ts,
      commit: input.commit,
      db: "ok",
      boss: { started: input.bossStarted, queues: input.queues },
    },
    httpStatus: 200,
  };
}
```

- [ ] **Step 4: Add the introspection export to `src/lib/queue/boss.ts`**

After `getBoss()`:

```typescript
/**
 * Returns the boss singleton ONLY if it has already started — never
 * triggers init. /api/health uses this so a health probe can't mask a
 * dead-workers state by warming boss itself.
 */
export function getStartedBoss(): PgBoss | null {
  return cached;
}
```

- [ ] **Step 5: Replace `src/app/api/health/route.ts` with**

```typescript
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { getStartedBoss } from "@/lib/queue/boss";
import { buildHealthPayload, type QueueHealth } from "@/lib/health/payload";

export const dynamic = "force-dynamic";

type QueueStatRow = {
  name: string;
  pending: number;
  active: number;
  failed: number;
  oldest_pending_sec: number | null;
};

export async function GET() {
  const commit = process.env.NEXT_PUBLIC_BUILD_COMMIT ?? "unknown";

  let dbOk = false;
  try {
    await db.execute(sql`select 1`);
    dbOk = true;
  } catch (err) {
    console.error("[health] db check failed:", err);
  }

  let queues: QueueHealth[] = [];
  if (dbOk) {
    try {
      const rows = await db.execute<QueueStatRow>(sql`
        select
          name,
          count(*) filter (where state in ('created', 'retry'))::int as pending,
          count(*) filter (where state = 'active')::int as active,
          count(*) filter (where state = 'failed')::int as failed,
          extract(epoch from now() - min(created_on)
            filter (where state in ('created', 'retry')))::int as oldest_pending_sec
        from pgboss.job
        group by name
        order by name
      `);
      queues = Array.from(rows).map((row) => ({
        name: row.name,
        pending: row.pending,
        active: row.active,
        failed: row.failed,
        oldestPendingSec: row.oldest_pending_sec,
      }));
    } catch (err) {
      // Fresh install: the pgboss schema doesn't exist until boss first
      // starts. DB itself is fine — report empty queue info, not "down".
      console.warn("[health] pgboss stats unavailable:", err);
    }
  }

  const { body, httpStatus } = buildHealthPayload({
    dbOk,
    bossStarted: getStartedBoss() !== null,
    queues,
    commit,
  });
  return NextResponse.json(body, { status: httpStatus });
}
```

- [ ] **Step 6: Verify**

Run: `npx vitest run tests/unit/health-payload.test.ts && npm run typecheck && npm run test && npm run lint`
Expected: all green.

Manual: `npm run dev`, then `curl -s localhost:3000/api/health | python3 -m json.tool` → `db: "ok"`, `boss.started: false` (nothing enqueued yet), `status: "degraded"`, queue rows listing `transcribe` etc. with integer counts. Hit the dashboard once (lazy boss may start via any enqueue path) — or don't; `started: false` is the honest pre-Task-8 answer.

- [ ] **Step 7: Commit**

```bash
git add src/lib/health/payload.ts src/lib/queue/boss.ts src/app/api/health/route.ts tests/unit/health-payload.test.ts
git commit -m "Real /api/health: db check, boss state, per-queue depth and age"
```

---

### Task 5: Retry decision logic + `POST /api/recordings/[id]/retry`

**Files:**
- Create: `src/lib/recordings/retry-plan.ts`
- Create: `src/app/api/recordings/[id]/retry/route.ts`
- Test: `tests/unit/retry-plan.test.ts`

This productizes the two incident scripts: `retrigger-stuck-transcripts.mjs` (no transcript → re-send `transcribe` with `r2_mixed_key ?? r2_composite_key`, audio vs video key field) and `requeue-ai-jobs.mjs` (transcript exists → re-send the AI jobs; we use the existing `enqueueAiJobs`, which adds chapters to the script's title-summary + action-items pair — strictly better). Audio notes flip straight to `ready` once a transcript exists (mirrors the webhook); re-enhancement stays owner-driven via the existing Enhance button.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/retry-plan.test.ts
import { describe, expect, it } from "vitest";
import { decideRetryStage } from "@/lib/recordings/retry-plan";

const NO_KEYS = {
  r2MixedKey: null,
  r2CompositeKey: null,
  r2MicKey: null,
  r2SystemaudioKey: null,
};

describe("decideRetryStage", () => {
  it("video without transcript → re-transcribe from the composite", () => {
    expect(
      decideRetryStage({
        type: "video",
        hasTranscript: false,
        ...NO_KEYS,
        r2CompositeKey: "media/abc/composite.webm",
      })
    ).toEqual({
      kind: "transcribe",
      sourceKey: "media/abc/composite.webm",
      isAudioSource: false,
    });
  });

  it("audio without transcript → re-transcribe; mixed key wins over mic", () => {
    expect(
      decideRetryStage({
        type: "audio",
        hasTranscript: false,
        ...NO_KEYS,
        r2MixedKey: "media/abc/mixed.m4a",
        r2MicKey: "media/abc/mic.m4a",
      })
    ).toEqual({
      kind: "transcribe",
      sourceKey: "media/abc/mixed.m4a",
      isAudioSource: true,
    });
  });

  it("no transcript and no uploaded media → unrecoverable", () => {
    const result = decideRetryStage({
      type: "video",
      hasTranscript: false,
      ...NO_KEYS,
    });
    expect(result.kind).toBe("unrecoverable");
  });

  it("video with transcript → re-run AI jobs", () => {
    expect(
      decideRetryStage({
        type: "video",
        hasTranscript: true,
        ...NO_KEYS,
        r2CompositeKey: "media/abc/composite.webm",
      })
    ).toEqual({ kind: "ai" });
  });

  it("audio with transcript → flip to ready (webhook parity)", () => {
    expect(
      decideRetryStage({
        type: "audio",
        hasTranscript: true,
        ...NO_KEYS,
        r2MixedKey: "media/abc/mixed.m4a",
      })
    ).toEqual({ kind: "audio-ready" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/retry-plan.test.ts`
Expected: FAIL — cannot resolve `@/lib/recordings/retry-plan`.

- [ ] **Step 3: Create `src/lib/recordings/retry-plan.ts`**

```typescript
// Pure stage decision for retrying a failed recording. Productizes the
// logic of scripts/retrigger-stuck-transcripts.mjs (no transcript) and
// scripts/requeue-ai-jobs.mjs (transcript exists).

export type RetryDecision =
  | { kind: "transcribe"; sourceKey: string; isAudioSource: boolean }
  | { kind: "ai" }
  | { kind: "audio-ready" }
  | { kind: "unrecoverable"; message: string };

export function decideRetryStage(input: {
  type: "video" | "audio";
  hasTranscript: boolean;
  r2MixedKey: string | null;
  r2CompositeKey: string | null;
  r2MicKey: string | null;
  r2SystemaudioKey: string | null;
}): RetryDecision {
  if (!input.hasTranscript) {
    // Same precedence as retrigger-stuck-transcripts.mjs, extended with the
    // raw audio tracks as a last resort for audio notes that failed before
    // mixing.
    const sourceKey =
      input.r2MixedKey ??
      input.r2CompositeKey ??
      input.r2MicKey ??
      input.r2SystemaudioKey;
    if (!sourceKey) {
      return {
        kind: "unrecoverable",
        message:
          "No uploaded media to transcribe — the upload never finished. Record again.",
      };
    }
    return {
      kind: "transcribe",
      sourceKey,
      isAudioSource: input.type === "audio",
    };
  }
  if (input.type === "audio") return { kind: "audio-ready" };
  return { kind: "ai" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/retry-plan.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Create `src/app/api/recordings/[id]/retry/route.ts`**

```typescript
import { requireAuth } from "@/lib/require-auth";
import { apiError, withApiErrorHandling } from "@/lib/api/error";
import { getRecordingOwned } from "@/db/queries/recordings";
import { getTranscriptByRecording } from "@/db/queries/transcripts";
import { getAiOutputByMedia, insertBlankAiOutput } from "@/db/queries/ai-outputs";
import { decideRetryStage } from "@/lib/recordings/retry-plan";
import { enqueueTranscription, enqueueThumbnail } from "@/lib/queue/boss";
import { enqueueAiJobs } from "@/lib/queue/enqueue-processing";
import { db } from "@/db";
import { mediaObjects } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";

/**
 * Owner-only: re-runs the pipeline for a failed recording from the
 * appropriate stage. Clears failure_reason and moves status back to the
 * matching in-progress value; the normal pipeline (webhook /
 * flipToReadyIfComplete / watchdog) takes it from there.
 */
export const POST = withApiErrorHandling(async (
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  const user = await requireAuth(request);
  const { id } = await params;

  const rec = await getRecordingOwned(id, user.id);
  if (!rec) return apiError(404, "not_found", "Recording not found.");
  if (rec.status !== "failed") {
    return apiError(
      409,
      "not_failed",
      "Only failed recordings can be retried. If it looks stuck, the watchdog will mark it failed within minutes of its threshold."
    );
  }

  const transcript = await getTranscriptByRecording(rec.id);
  const decision = decideRetryStage({
    type: rec.type,
    hasTranscript: Boolean(transcript?.fullText.trim()),
    r2MixedKey: rec.r2MixedKey,
    r2CompositeKey: rec.r2CompositeKey,
    r2MicKey: rec.r2MicKey,
    r2SystemaudioKey: rec.r2SystemaudioKey,
  });

  if (decision.kind === "unrecoverable") {
    return apiError(409, "unrecoverable", decision.message);
  }

  const setStatus = (status: "transcribing" | "processing" | "ready") =>
    db
      .update(mediaObjects)
      .set({ status, failureReason: null, updatedAt: sql`now()` })
      .where(
        and(eq(mediaObjects.id, rec.id), eq(mediaObjects.ownerId, user.id))
      );

  if (decision.kind === "transcribe") {
    await setStatus("transcribing");
    await enqueueTranscription(
      decision.isAudioSource
        ? { mediaObjectId: rec.id, audioKey: decision.sourceKey }
        : { mediaObjectId: rec.id, compositeKey: decision.sourceKey }
    );
    return Response.json({ ok: true, stage: "transcribe" });
  }

  if (decision.kind === "audio-ready") {
    // Transcript exists; audio notes are 'ready' at that point (webhook
    // parity). Re-enhancement stays on the existing Enhance button.
    await setStatus("ready");
    return Response.json({ ok: true, stage: "ready" });
  }

  // decision.kind === "ai" — transcript exists, re-run the transcript-
  // dependent jobs. flipToReadyIfComplete also requires a thumbnail, so
  // re-enqueue that too when it's missing (otherwise retry can never
  // reach 'ready').
  const llmModel =
    process.env.LLM_MODEL ?? process.env.LLM_MODEL_ID ?? "claude-sonnet-4-6";
  if (!(await getAiOutputByMedia(rec.id))) {
    await insertBlankAiOutput(rec.id, llmModel);
  }
  await setStatus("processing");
  await enqueueAiJobs({ mediaObjectId: rec.id });
  if (!rec.compositeThumbnailKey && rec.r2CompositeKey) {
    await enqueueThumbnail({
      mediaObjectId: rec.id,
      compositeKey: rec.r2CompositeKey,
    });
  }
  return Response.json({ ok: true, stage: "ai" });
});
```

- [ ] **Step 6: Verify**

Run: `npm run typecheck && npm run test && npm run lint`
Expected: all green.

Manual (dev DB): mark one of your dev recordings failed — `psql $DATABASE_URL -c "update media_objects set status='failed', failure_reason='manual test' where slug='<some-dev-slug>'"` — then `curl -X POST -b "<your dev session cookies>" localhost:3000/api/recordings/<id>/retry` → `{"ok":true,"stage":"ai"}` (or use the UI from Task 6). Confirm the row flips to `processing` with `failure_reason` null.

- [ ] **Step 7: Commit**

```bash
git add src/lib/recordings/retry-plan.ts "src/app/api/recordings/[id]/retry/route.ts" tests/unit/retry-plan.test.ts
git commit -m "Add owner retry route that re-runs the pipeline from the right stage"
```

---

### Task 6: Failure UX — reason + Retry on card, edit page, share page

**Files:**
- Modify: `src/components/dashboard/recording-card.tsx` (reason line; pass status to menu)
- Modify: `src/components/dashboard/recording-card-menu.tsx` (Retry item)
- Modify: `src/components/edit/edit-header.tsx` (failure banner + Retry button)
- Modify: `src/app/recordings/[id]/edit/page.tsx` (pass `failureReason`) — ⚠️ **this file has unrelated uncommitted transcript-export hunks; see the working-tree warning in the header**
- Modify: `src/app/v/[slug]/page.tsx` (failed branch in the not-ready block)

`failureReason` flows automatically into `Recording` / `RecordingWithBrand` via `$inferSelect` + the `...row.rec` spreads in `src/db/queries/recordings.ts` once Task 1's schema change lands — no query changes needed. The `Badge` already has a `failed` variant.

- [ ] **Step 1: Recording card — show the reason**

In `src/components/dashboard/recording-card.tsx`, inside the `<div className="flex flex-col gap-1 p-3">` block, directly after the `<h3>…{displayTitle}…</h3>` element, add:

```tsx
          {rec.status === "failed" && (
            <p
              className="truncate text-xs text-destructive"
              title={rec.failureReason ?? undefined}
            >
              {rec.failureReason ?? "Processing failed."}
            </p>
          )}
```

And change the menu invocation (line ~268) to pass status:

```tsx
        <RecordingCardMenu rec={rec.id ? { id: rec.id, status: rec.status } : { id: rec.id, status: rec.status }} ... />
```

— no. Keep it simple and explicit:

```tsx
        <RecordingCardMenu
          recordingId={rec.id}
          status={rec.status}
          folders={folders}
        />
```

- [ ] **Step 2: Card menu — Retry item**

In `src/components/dashboard/recording-card-menu.tsx`:

Add imports: `RotateCcw` to the lucide import; `import { toast } from "sonner";`.

Change the props:

```tsx
export function RecordingCardMenu({
  recordingId,
  status,
  folders,
}: {
  recordingId: string;
  status: "uploading" | "transcribing" | "processing" | "ready" | "failed";
  folders: Folder[];
}) {
```

Add next to `handleDelete`:

```tsx
  async function handleRetry() {
    setOpen(false);
    const res = await fetch(`/api/recordings/${recordingId}/retry`, {
      method: "POST",
    });
    const body = (await res.json().catch(() => null)) as {
      message?: string;
    } | null;
    if (!res.ok) {
      toast.error(body?.message ?? `Retry failed (${res.status}).`);
      return;
    }
    toast.success("Retry started.");
    router.refresh();
  }
```

In the non-`showMove` menu branch, directly above the Delete button, add:

```tsx
                {status === "failed" && (
                  <button
                    type="button"
                    onClick={() => void handleRetry()}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-text-muted hover:bg-bg-subtle hover:text-text"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Retry processing
                  </button>
                )}
```

- [ ] **Step 3: Edit header — failure banner + Retry**

In `src/components/edit/edit-header.tsx`:

Add imports: `import { toast } from "sonner";` and `RotateCcw` to the lucide import.

Add the prop (type and destructuring): `failureReason: string | null;`.

Add state + handler next to the existing ones:

```tsx
  const [retrying, setRetrying] = useState(false);

  async function retry() {
    setRetrying(true);
    try {
      const res = await fetch(`/api/recordings/${recordingId}/retry`, {
        method: "POST",
      });
      const body = (await res.json().catch(() => null)) as {
        message?: string;
      } | null;
      if (!res.ok) {
        toast.error(body?.message ?? `Retry failed (${res.status}).`);
        return;
      }
      toast.success("Retry started — this page will update as it progresses.");
      router.refresh();
    } finally {
      setRetrying(false);
    }
  }
```

Directly after the `{error && <p …>{error}</p>}` line, add:

```tsx
      {status === "failed" && (
        <div className="mt-3 flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
          <p className="min-w-0 flex-1 text-xs leading-relaxed text-destructive">
            {failureReason ?? "Processing failed."}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void retry()}
            disabled={retrying}
            className="shrink-0"
          >
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
            {retrying ? "Retrying…" : "Retry"}
          </Button>
        </div>
      )}
```

- [ ] **Step 4: Edit page — pass the reason**

In `src/app/recordings/[id]/edit/page.tsx`, in the `<EditHeader …>` invocation add:

```tsx
                failureReason={rec.failureReason}
```

- [ ] **Step 5: Share page — failed branch**

In `src/app/v/[slug]/page.tsx`, replace the not-ready placeholder block (the `<div className="rounded-xl border border-dashed …">` with the pulse dot and "Refresh in ~15–30 seconds" copy) with:

```tsx
          <div className="rounded-xl border border-dashed border-border bg-bg-subtle/40 p-12 text-center">
            <div className="inline-flex items-center gap-2 text-base font-medium text-text">
              {rec.status === "failed" ? (
                <span
                  aria-hidden="true"
                  className="h-2 w-2 rounded-full bg-destructive"
                />
              ) : (
                <span
                  aria-hidden="true"
                  className="h-2 w-2 animate-pulse rounded-full bg-accent"
                />
              )}
              {rec.status === "failed"
                ? "Processing failed"
                : rec.status === "transcribing"
                  ? "Transcription in progress"
                  : rec.status === "processing"
                    ? "AI outputs generating"
                    : rec.status === "uploading"
                      ? "Uploading"
                      : "Not ready"}
            </div>
            {rec.status === "failed" ? (
              <p className="mt-3 text-sm text-text-subtle">
                {/* failure_reason can mention provider/billing details —
                    owner-only. Visitors get a neutral line. */}
                {isOwner && rec.failureReason
                  ? rec.failureReason
                  : "The owner has been notified and can retry from their dashboard."}
              </p>
            ) : (
              <p className="mt-3 text-sm text-text-subtle">
                Refresh in ~15–30 seconds — this page will catch up
                automatically.
              </p>
            )}
          </div>
```

- [ ] **Step 6: Verify**

Run: `npm run typecheck && npm run test && npm run lint`
Expected: all green.

Manual (dev): with the row you failed in Task 5, check (a) dashboard card shows the `failed` badge + the reason line + "Retry processing" in the card menu; (b) `/recordings/<id>/edit` shows the banner with the reason and a working Retry button (status flips to `processing`, banner disappears on refresh); (c) `/v/<slug>` in a logged-out window shows "Processing failed" + the neutral line, no reason text.

- [ ] **Step 7: Commit** (⚠️ if `git diff "src/app/recordings/[id]/edit/page.tsx"` still shows the transcript-export hunks, resolve per the header warning before this commit and say so in the message)

```bash
git add src/components/dashboard/recording-card.tsx src/components/dashboard/recording-card-menu.tsx \
  src/components/edit/edit-header.tsx "src/app/recordings/[id]/edit/page.tsx" "src/app/v/[slug]/page.tsx"
git commit -m "Render failure reason with owner Retry on card, edit, and share pages"
```

---

### Task 7: Upload retry with backoff + beforeunload guard

**Files:**
- Modify: `src/lib/recording/upload-coordinator.ts` (retrying `uploadPart`)
- Modify: `src/components/record/record-flow.tsx` (beforeunload while recording/uploading)
- Test: `tests/unit/upload-part-retry.test.ts`

Policy: 1 initial attempt + 3 retries per part; delays 1s/2s/4s base with ±50% jitter; **a fresh presigned URL is fetched on every attempt** (the simplest way to honor "re-fetch a fresh part URL on retry" — it also covers URL-expiry failures, and `part-url` fetches are themselves inside the retried scope). All failures are retried (network `TypeError`, 5xx, 403-expired-signature alike) — after 4 attempts the original error surfaces through the existing `finalize → complete` error path. Per the spec, only the **decision logic** (delay schedule) is unit-tested, not the fetch loop.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/upload-part-retry.test.ts
import { describe, expect, it } from "vitest";
import {
  MAX_PART_ATTEMPTS,
  partRetryDelayMs,
} from "@/lib/recording/upload-coordinator";

describe("part upload retry policy", () => {
  it("allows 1 initial attempt + 3 retries", () => {
    expect(MAX_PART_ATTEMPTS).toBe(4);
  });

  it("backs off exponentially: 1s, 2s, 4s at the jitter midpoint", () => {
    const mid = () => 0.5; // 0.5 + 0.5 → exactly 1.0x
    expect(partRetryDelayMs(0, mid)).toBe(1000);
    expect(partRetryDelayMs(1, mid)).toBe(2000);
    expect(partRetryDelayMs(2, mid)).toBe(4000);
  });

  it("jitters within 0.5x–1.5x of the base", () => {
    expect(partRetryDelayMs(0, () => 0)).toBe(500);
    expect(partRetryDelayMs(0, () => 0.9999)).toBeGreaterThan(1490);
    expect(partRetryDelayMs(0, () => 0.9999)).toBeLessThan(1500);
    for (let i = 0; i < 50; i++) {
      const d = partRetryDelayMs(1, Math.random);
      expect(d).toBeGreaterThanOrEqual(1000);
      expect(d).toBeLessThanOrEqual(3000);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/upload-part-retry.test.ts`
Expected: FAIL — `MAX_PART_ATTEMPTS` / `partRetryDelayMs` not exported.

- [ ] **Step 3: Modify `src/lib/recording/upload-coordinator.ts`**

Below the `TARGET_PART_SIZE` constant, add:

```typescript
/** 1 initial attempt + 3 retries per part. */
export const MAX_PART_ATTEMPTS = 4;

/**
 * Exponential backoff with jitter for part-upload retries: base 1s/2s/4s
 * for retryIndex 0/1/2, scaled by a random 0.5x–1.5x so simultaneous
 * failures across the five tracks don't retry in lockstep.
 */
export function partRetryDelayMs(
  retryIndex: number,
  random: () => number = Math.random
): number {
  const base = 1000 * 2 ** retryIndex;
  return Math.round(base * (0.5 + random()));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

Replace the `uploadPart` function inside `createUploadCoordinator` with:

```typescript
  async function uploadPart(
    kind: TrackKind,
    state: TrackState,
    partNumber: number,
    body: Blob
  ): Promise<void> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < MAX_PART_ATTEMPTS; attempt++) {
      if (attempt > 0) await sleep(partRetryDelayMs(attempt - 1));
      try {
        // Fresh presigned URL EVERY attempt: a failed PUT may mean the
        // previous URL expired, and the part-url fetch itself is a network
        // call that deserves the same retry envelope.
        const url = await getPartUrl(kind, partNumber);
        const res = await fetch(url, { method: "PUT", body });
        if (!res.ok) {
          throw new Error(`Part ${partNumber} of ${kind} failed: ${res.status}`);
        }
        const etag = res.headers.get("ETag");
        if (!etag) {
          throw new Error(`Part ${partNumber} of ${kind} returned no ETag`);
        }
        state.completedParts.push({ PartNumber: partNumber, ETag: etag });
        state.uploadedBytes += body.size;
        reportProgress();
        return;
      } catch (err) {
        lastErr = err;
        console.warn(
          `[upload] part ${partNumber} (${kind}) attempt ${attempt + 1}/${MAX_PART_ATTEMPTS} failed:`,
          err
        );
      }
    }
    throw lastErr instanceof Error
      ? lastErr
      : new Error(`Part ${partNumber} of ${kind} failed after ${MAX_PART_ATTEMPTS} attempts`);
  }
```

(Everything else in the file — buffering, `flushBuffer`, `finalize` — is untouched; failed parts still reject the in-flight promise that `finalize` awaits, so the existing `complete`-route error path is unchanged.)

- [ ] **Step 4: beforeunload guard in `src/components/record/record-flow.tsx`**

Change the react import to `import { useCallback, useEffect, useReducer, useRef } from "react";` and add inside `RecordFlow`, right after the `useReducer` line:

```tsx
  // Closing the tab mid-recording loses the capture; mid-upload it strands
  // a partial multipart upload. Chrome shows its generic "Leave site?"
  // dialog — that's all we can do, and it's enough.
  useEffect(() => {
    if (state.kind !== "recording" && state.kind !== "uploading") return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [state.kind]);
```

- [ ] **Step 5: Verify**

Run: `npx vitest run tests/unit/upload-part-retry.test.ts tests/unit/upload-coordinator-buffer.test.ts && npm run typecheck && npm run test && npm run lint`
Expected: all green (existing coordinator buffer tests must still pass).

Manual: `npm run dev`, record a short clip; in DevTools → Network, right-click the first part PUT → "Block request URL" mid-recording, watch the console log `attempt 1/4 failed` then succeed after unblocking (or use Network → Offline for a few seconds). Try closing the tab during upload → Chrome's leave-site dialog appears.

- [ ] **Step 6: Commit**

```bash
git add src/lib/recording/upload-coordinator.ts src/components/record/record-flow.tsx tests/unit/upload-part-retry.test.ts
git commit -m "Retry part uploads with backoff and fresh URLs; warn before unload"
```

---

### Task 8 (LAST — hard gate before push): pg-boss boot-warm, attempt 2

**Files:**
- Create: `src/instrumentation.ts`
- Verify only (no change expected): `next.config.ts` — `serverExternalPackages: ["pg-boss", "pg", "pg-native"]` already present (added in `6e0feca`, the post-outage fix; pg-boss v12's runtime deps are `pg`, `cron-parser`, `serialize-error`, and the externalized `pg-boss` resolves those via normal `require` at runtime, so the list is sufficient)

**Outage history (read before touching anything):** `94146b8` added `src/instrumentation.ts` calling `getBoss()` → 3 consecutive Coolify builds failed (`pgpass` couldn't resolve `fs`/`net`/`path` in the **Edge** bundle) → `c094e26` split a node-only file with `/* webpackIgnore: true */`, which built green but **500'd every request in prod** (site-wide outage) → `8e5eda1` reverted → `6e0feca` added `serverExternalPackages` and accepted lazy init. Two things are different now: (1) `serverExternalPackages` keeps `pg-boss`/`pg` out of the **Node** server bundle entirely; (2) the May code used an **early-return** runtime guard (`if (process.env.NEXT_RUNTIME !== "nodejs") return;` … `await import(…)`) — webpack's parser only dead-branch-eliminates **`if`-statement bodies** with build-time-constant conditions (`NEXT_RUNTIME` is inlined per-bundle by DefinePlugin), it does **not** do control-flow analysis past an early `return`, so the import was still compiled into the **Edge** instrumentation bundle. The fix is Next's own documented pattern: the dynamic import goes **inside** the `if` block. The try/catch then guarantees that even a runtime warm-up failure (bad `DATABASE_URL`, DB outage at boot) degrades to the current lazy-init behavior instead of crashing the app.

- [ ] **Step 1: Confirm prerequisites on a clean tree**

```bash
git status --short          # only the known transcript-export leftovers, nothing from Tasks 1-7 unstaged
grep -n "serverExternalPackages" next.config.ts
```
Expected: `serverExternalPackages: ["pg-boss", "pg", "pg-native"],` present. Tasks 1–7 committed (and ideally already deployed green — check the Coolify dashboard / `curl -s https://loom.dissonance.cloud/api/health`).

- [ ] **Step 2: Create `src/instrumentation.ts`**

```typescript
/**
 * Next.js boot hook — register() runs once per server runtime at startup.
 * Warms pg-boss so queue workers poll from container boot instead of
 * waiting for the first enqueue-triggering HTTP request. Without this,
 * every Coolify restart leaves workers dead until someone records
 * (2026-05-06: a 72-min recording sat in 'transcribing' for 95 minutes;
 * scripts/wake-prod-boss.mjs was the manual fix).
 *
 * ⚠️ HISTORY — this file caused a full prod outage in May 2026 (commits
 * 94146b8 → c094e26, reverted in 8e5eda1). Two invariants keep it safe:
 *
 * 1. The dynamic import MUST stay INSIDE the `if` block. NEXT_RUNTIME is
 *    inlined per-bundle at build time, and webpack dead-branch-eliminates
 *    only constant `if` statements — NOT code after an early `return`.
 *    The May version used an early return, so pg/pgpass were compiled
 *    into the Edge (middleware) bundle and broke the build.
 * 2. serverExternalPackages in next.config.ts must keep "pg-boss"/"pg"
 *    external to the Node server bundle (added in 6e0feca; verified by
 *    this task's container gate).
 *
 * The try/catch means a warm-up failure can NEVER take the app down —
 * worst case we log and fall back to the pre-Phase-3 lazy init on the
 * first enqueue call.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const { getBoss } = await import("@/lib/queue/boss");
      await getBoss();
      console.log("[instrumentation] pg-boss warmed at boot — workers polling");
    } catch (err) {
      console.error(
        "[instrumentation] pg-boss boot warm-up failed (app continues; workers start lazily on first enqueue):",
        err
      );
    }
  }
}
```

- [ ] **Step 3: GATE 1/3 — production build is green**

Run: `npm run build`
Expected: completes with no errors — specifically **no** `Module not found: Can't resolve 'fs'|'net'|'tls'|'pgpass'` in any compiled-for-Edge output (that exact failure killed builds in May). Also run `npm run typecheck && npm run test && npm run lint` — all green.

- [ ] **Step 4: GATE 2/3 — container builds green**

```bash
doppler run --project dissonance-cloud --config prd_loom -- sh -c '
  docker build -t loomola-bootwarm \
    --build-arg NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    --build-arg NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL .'
```
Expected: image builds clean.

- [ ] **Step 5: GATE 3/3 — workers poll at boot WITHOUT any enqueue**

⚠️ This runs the real prod env (Doppler `prd_loom`) — the container's workers will connect to the prod DB and process prod jobs, same as `scripts/wake-prod-boss.mjs` does deliberately. Keep the session short and stop the container when done.

```bash
doppler secrets download --project dissonance-cloud --config prd_loom --no-file --format docker > /tmp/loomola-prd.env
docker run --rm --name loomola-bootwarm -p 3001:3000 --env-file /tmp/loomola-prd.env loomola-bootwarm
```

**Observe — all four, in order, with ZERO requests made to the container first:**

1. **Log line** within ~15s of `✓ Ready`: `[pg-boss] started and workers registered (9 queues)` (13 if `ENABLE_GRANOLA=true` in prd) followed by `[instrumentation] pg-boss warmed at boot — workers polling`. This is the boot-warm itself.
2. **Health probe** (safe — Task 4's endpoint never starts boss, so this cannot cause what it measures): `curl -s http://localhost:3001/api/health | python3 -m json.tool` → `"boss": {"started": true, ...}` with the queue list populated.
3. **DB evidence the scheduler registered at boot** (proves `work()`/`schedule()` ran, not just `start()`):
   `doppler run --project dissonance-cloud --config prd_loom -- sh -c 'psql "$DATABASE_URL" -c "select name, cron, updated_on from pgboss.schedule"'` → `watchdog_stuck_recordings | */10 * * * *` with `updated_on` ≈ container boot time.
4. **Negative control — warm-up failure cannot crash the app:** stop the container, rerun with a poisoned DB URL:
   `docker run --rm -p 3001:3000 --env-file /tmp/loomola-prd.env -e DATABASE_URL=postgresql://invalid:invalid@127.0.0.1:9/none loomola-bootwarm`
   Expected: the `[instrumentation] pg-boss boot warm-up failed` error logs, **and** the server still answers `curl -s -o /dev/null -w '%{http_code}' http://localhost:3001/api/health` → `503` (down because DB is down — but answering, not crashed). Ctrl-C the container.

Cleanup:

```bash
rm /tmp/loomola-prd.env
docker rm -f loomola-bootwarm 2>/dev/null || true
```

**If any of the four observations fails, STOP — do not commit, do not push.** Debug with superpowers:systematic-debugging; the failure modes to suspect first are exactly the historical ones (edge bundle pulled pg in; standalone output missing an externalized module).

- [ ] **Step 6: Commit and push as an isolated, revertable change**

```bash
git add src/instrumentation.ts
git commit -m "Boot-warm pg-boss via instrumentation hook, attempt 2

serverExternalPackages (6e0feca) keeps pg out of the Node bundle; the
dynamic import now sits INSIDE the constant-condition if block so the
Edge bundle dead-branch-eliminates it (the May 2026 version's early
return defeated that, breaking 3 builds and then prod). try/catch
guarantees warm-up failure degrades to lazy init instead of an outage.
Verified: next build, docker build, and a local container run against
prd env showing workers polling with zero enqueues."
git push origin main
```

- [ ] **Step 7: Watch the deploy like a hawk**

Coolify auto-deploys the push. Immediately after it goes live:

```bash
curl -s https://loom.dissonance.cloud/api/health | python3 -m json.tool
```
Expected: `boss.started: true` and `status: "ok"` (or `degraded` with a populated queue list) **without anyone having recorded since the restart** — the thing that has never been true before. Browse the site for 2 minutes (dashboard, a share page). **Rollback if anything is off:** `git revert HEAD && git push origin main` restores lazy init (the known-good state) in one deploy cycle.

- [ ] **Step 8: Retire the workaround's prominence**

Optional follow-up (don't block on it): note in `scripts/wake-prod-boss.mjs`'s header comment that it is now a fallback only, superseded by `src/instrumentation.ts`.

---

## Spec-coverage self-check

| Spec item | Where |
|---|---|
| 3.1 Boot-warm attempt 2: `serverExternalPackages` + runtime guard + dynamic import + try/catch | Task 8 (config already present, verified there) |
| 3.1 Hard gate: build green AND container boots AND health shows workers alive with no enqueue | Task 8 Steps 3–5 (three explicit gates + negative control) |
| 3.2 Health: db, boss started, per-queue pending/active/failed, oldest-pending age, commit | Task 4 |
| 3.2 Degraded = 200, 503 only on DB-down, non-sensitive public payload | Task 4 (`buildHealthPayload` + tests) |
| 3.3 Watchdog every 10 min, transcribing>2h / processing>1h, marks failed with reason | Task 2 (plus uploading>24h sweep) |
| 3.3 `failure_reason` written at point of failure (Deepgram 402, LLM exhaustion) | Task 1 |
| 3.4 Failed state + reason on card / edit / share page | Task 6 (share page reason is owner-only) |
| 3.4 Owner Retry re-enqueues from the right stage (productizes both incident scripts) | Tasks 5 + 6 |
| 3.5 Part PUT + part-URL retry 3× backoff+jitter, fresh URL per retry, beforeunload | Task 7 |
| 3.6 `apiError` + `withApiErrorHandling`, adopted in routes this effort touches; alert() → toast | Task 3 (helper + the one remaining alert site), Task 5 (adoption) |

---

### Critical Files for Implementation
- /Users/iancross/Development/03Utilities/Loom_Clone/src/lib/queue/boss.ts
- /Users/iancross/Development/03Utilities/Loom_Clone/src/db/schema.ts
- /Users/iancross/Development/03Utilities/Loom_Clone/src/app/api/health/route.ts
- /Users/iancross/Development/03Utilities/Loom_Clone/src/lib/recording/upload-coordinator.ts
- /Users/iancross/Development/03Utilities/Loom_Clone/next.config.ts