import { db } from "@/db";
import { mediaObjects } from "@/db/schema";
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { pruneExpiredNonces } from "@/lib/deepgram/callback-signature";
import { sendEmail, isEmailConfigured } from "@/lib/mail/mailgun";
import {
  renderRecordingFailedEmail,
  type FailedRecordingEmailItem,
} from "@/lib/mail/templates/recording-failed";
import { getSupabaseService } from "@/lib/supabase/service";

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
  const failedByOwner = new Map<string, FailedRecordingEmailItem[]>();
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
      .returning({
        id: mediaObjects.id,
        slug: mediaObjects.slug,
        title: mediaObjects.title,
        type: mediaObjects.type,
        ownerId: mediaObjects.ownerId,
        failureReason: mediaObjects.failureReason,
      });
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
    for (const row of rows) {
      console.warn(
        `[watchdog] ${row.id}: stuck in '${threshold.status}' past ${Math.round(
          threshold.maxAgeMs / 60_000
        )}min — marked failed`
      );
      const items = failedByOwner.get(row.ownerId) ?? [];
      items.push({
        title: row.title ?? "Untitled recording",
        kind: row.type === "audio" ? "audio" : "video",
        reason: row.failureReason ?? threshold.reason,
        url:
          row.type === "audio"
            ? `${appUrl}/notes/${row.slug}`
            : `${appUrl}/recordings/${row.id}/edit`,
      });
      failedByOwner.set(row.ownerId, items);
    }
    total += rows.length;
  }

  // Email each affected owner once per tick. The stuck→failed transition
  // only happens once per row, so there's no repeat-nag risk. Best-effort:
  // a mail failure must never fail the watchdog job (it would retry the
  // UPDATE against rows that are no longer in a stuck state and do nothing,
  // but the log noise misleads).
  if (failedByOwner.size > 0 && isEmailConfigured()) {
    const service = getSupabaseService();
    for (const [ownerId, items] of failedByOwner) {
      try {
        const { data } = await service.auth.admin.getUserById(ownerId);
        const ownerEmail = data?.user?.email;
        if (!ownerEmail) {
          console.warn(`[watchdog] owner email missing for ${ownerId}; skipping failure email`);
          continue;
        }
        const tpl = renderRecordingFailedEmail({ items });
        await sendEmail({
          to: ownerEmail,
          subject: tpl.subject,
          text: tpl.text,
          html: tpl.html,
        });
        console.log(`[watchdog] failure email sent to owner ${ownerId} (${items.length} recording(s))`);
      } catch (err) {
        console.error(`[watchdog] failure email to ${ownerId} failed:`, err);
      }
    }
  }
  // Piggyback table hygiene on the same 10-minute tick: webhook_nonces
  // otherwise grows one row per transcription forever.
  try {
    await pruneExpiredNonces(now);
  } catch (err) {
    console.error("[watchdog] nonce prune failed:", err);
  }
  return total;
}
