import { db } from "@/db";
import { views } from "@/db/schema";
import { eq, sql, inArray } from "drizzle-orm";

/**
 * Upsert a view row. If the (media_object_id, visitor_hash) pair already
 * exists, bumps `updated_at`; otherwise inserts a fresh row with the given
 * user-agent summary.
 *
 * Returns `{ inserted }` so callers can branch on first-view-per-visitor
 * (e.g. fire an owner notification email). The detection uses the
 * `created_at = updated_at` invariant: on a fresh insert both default to
 * `now()`; on a DO UPDATE we set `updated_at` to a new `now()` while
 * `created_at` keeps its earlier value, making the equality false.
 */
export async function upsertView(params: {
  mediaObjectId: string;
  visitorHash: string;
  userAgentSummary: string;
}): Promise<{ inserted: boolean }> {
  const [row] = await db
    .insert(views)
    .values({
      mediaObjectId: params.mediaObjectId,
      viewerIpHash: params.visitorHash,
      userAgentSummary: params.userAgentSummary,
    })
    .onConflictDoUpdate({
      target: [views.mediaObjectId, views.viewerIpHash],
      set: { updatedAt: sql`now()` },
    })
    .returning({
      inserted: sql<boolean>`${views.createdAt} = ${views.updatedAt}`,
    });
  return { inserted: row?.inserted === true };
}

/**
 * Lazily creates the view row (with empty UA summary) if missing, then
 * updates max_watched_sec (only raising it) and increments watched_seconds
 * by 5 — one beacon pulse's worth of time.
 */
export async function updateProgress(params: {
  mediaObjectId: string;
  visitorHash: string;
  currentTimeSec: number;
}): Promise<void> {
  await db
    .insert(views)
    .values({
      mediaObjectId: params.mediaObjectId,
      viewerIpHash: params.visitorHash,
      maxWatchedSec: String(params.currentTimeSec),
      watchedSeconds: "5",
    })
    .onConflictDoUpdate({
      target: [views.mediaObjectId, views.viewerIpHash],
      set: {
        maxWatchedSec: sql`GREATEST(${views.maxWatchedSec}, ${String(params.currentTimeSec)}::numeric)`,
        watchedSeconds: sql`${views.watchedSeconds} + 5`,
        updatedAt: sql`now()`,
      },
    });
}

export async function countViews(mediaObjectId: string): Promise<number> {
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(views)
    .where(eq(views.mediaObjectId, mediaObjectId));
  return row?.c ?? 0;
}

export async function listViewCounts(
  mediaObjectIds: string[]
): Promise<Record<string, number>> {
  if (mediaObjectIds.length === 0) return {};
  const rows = await db
    .select({
      mediaObjectId: views.mediaObjectId,
      c: sql<number>`count(*)::int`,
    })
    .from(views)
    .where(inArray(views.mediaObjectId, mediaObjectIds))
    .groupBy(views.mediaObjectId);
  const map: Record<string, number> = {};
  for (const r of rows) map[r.mediaObjectId] = r.c;
  return map;
}

/**
 * Returns the per-viewer max_watched_sec for a single recording, as an
 * array of numbers. Used as the input to `bucketize()`.
 */
export async function listMaxWatched(
  mediaObjectId: string
): Promise<number[]> {
  const rows = await db
    .select({ m: views.maxWatchedSec })
    .from(views)
    .where(eq(views.mediaObjectId, mediaObjectId));
  return rows.map((r) => parseFloat(String(r.m ?? "0")));
}
