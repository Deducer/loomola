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
