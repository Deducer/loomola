import { db } from "@/db";
import { mediaObjects, noteAttachments } from "@/db/schema";
import { and, eq, isNotNull, lt } from "drizzle-orm";
import {
  deleteObjects,
  deleteObjectsByPrefix,
} from "@/lib/r2/delete-objects";

export const PURGE_JOB = "purge_deleted";
export const PURGE_CRON = "20 4 * * *"; // daily, off-peak UTC
const PURGE_BATCH = 25;

/** Days a soft-deleted recording stays recoverable in the trash before its
 *  row and storage objects are reclaimed. */
export function trashRetentionDays(): number {
  const parsed = Number.parseInt(process.env.TRASH_RETENTION_DAYS ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
}

/**
 * Permanently removes one recording: every R2 object under its slug prefix
 * (composite, raw tracks, playback, mixed audio, legacy transcript-channels,
 * thumbnail, sprite, waveform), its note attachments (different prefix,
 * keys tracked in the DB), then the row itself — FK cascades reclaim
 * transcripts (incl. word_timestamps), ai_outputs, transcript_chunks,
 * embeddings, comments, and views. Storage first, row second: if a storage
 * delete fails the row survives and the next run retries.
 */
export async function purgeMediaObject(row: {
  id: string;
  slug: string;
}): Promise<void> {
  const attachments = await db
    .select({ r2Key: noteAttachments.r2Key })
    .from(noteAttachments)
    .where(eq(noteAttachments.mediaObjectId, row.id));
  if (attachments.length > 0) {
    await deleteObjects(attachments.map((a) => a.r2Key));
  }
  if (row.slug) {
    await deleteObjectsByPrefix(`${row.slug}/`);
  }
  await db.delete(mediaObjects).where(eq(mediaObjects.id, row.id));
}

/**
 * Trash reaper: hard-deletes recordings whose soft-delete is older than the
 * retention window. Before this job existed, "deleting" a recording only
 * set deleted_at — every R2 object and heavy DB child row was kept forever.
 * Bounded batch per run; the daily cadence drains any backlog.
 */
export async function runPurgeJob(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(
    now.getTime() - trashRetentionDays() * 24 * 60 * 60 * 1000
  );
  const rows = await db
    .select({ id: mediaObjects.id, slug: mediaObjects.slug })
    .from(mediaObjects)
    .where(
      and(isNotNull(mediaObjects.deletedAt), lt(mediaObjects.deletedAt, cutoff))
    )
    .limit(PURGE_BATCH);

  let purged = 0;
  for (const row of rows) {
    try {
      await purgeMediaObject(row);
      purged += 1;
      console.log(`[purge] reclaimed ${row.id} (${row.slug})`);
    } catch (err) {
      // Row survives; the next daily run retries it.
      console.error(`[purge] failed for ${row.id}:`, err);
    }
  }
  if (rows.length > 0) {
    console.log(`[purge] run complete: ${purged}/${rows.length} purged`);
  }
  return purged;
}

/** Owner-scoped immediate purge backing the trash page's "Delete forever". */
export async function purgeMediaObjectOwned(
  id: string,
  ownerId: string
): Promise<boolean> {
  const [row] = await db
    .select({ id: mediaObjects.id, slug: mediaObjects.slug })
    .from(mediaObjects)
    .where(
      and(
        eq(mediaObjects.id, id),
        eq(mediaObjects.ownerId, ownerId),
        isNotNull(mediaObjects.deletedAt)
      )
    )
    .limit(1);
  if (!row) return false;
  await purgeMediaObject(row);
  return true;
}
