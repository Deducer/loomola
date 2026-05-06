import { db } from "@/db";
import { folders, mediaFolderAssignments, mediaObjects } from "@/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";

export type Folder = typeof folders.$inferSelect;

export async function listFoldersForOwner(
  ownerId: string
): Promise<Folder[]> {
  return db
    .select()
    .from(folders)
    .where(eq(folders.ownerId, ownerId))
    .orderBy(folders.name);
}

export async function getFolderOwned(
  id: string,
  ownerId: string
): Promise<Folder | null> {
  const [row] = await db
    .select()
    .from(folders)
    .where(and(eq(folders.id, id), eq(folders.ownerId, ownerId)))
    .limit(1);
  return row ?? null;
}

export async function createFolder(params: {
  ownerId: string;
  name: string;
  parentId: string | null;
}): Promise<Folder> {
  const [row] = await db
    .insert(folders)
    .values({
      ownerId: params.ownerId,
      name: params.name,
      parentId: params.parentId,
    })
    .returning();
  return row;
}

export async function updateFolder(params: {
  id: string;
  ownerId: string;
  name?: string;
  parentId?: string | null;
}): Promise<boolean> {
  const set: Partial<{
    name: string;
    parentId: string | null;
    updatedAt: Date;
  }> = {};
  if (params.name !== undefined) set.name = params.name;
  if (params.parentId !== undefined) set.parentId = params.parentId;
  if (Object.keys(set).length === 0) return true;
  const result = await db
    .update(folders)
    .set({ ...set, updatedAt: sql`now()` })
    .where(and(eq(folders.id, params.id), eq(folders.ownerId, params.ownerId)))
    .returning({ id: folders.id });
  return result.length > 0;
}

export async function deleteFolderOwned(params: {
  id: string;
  ownerId: string;
}): Promise<boolean> {
  const result = await db
    .delete(folders)
    .where(and(eq(folders.id, params.id), eq(folders.ownerId, params.ownerId)))
    .returning({ id: folders.id });
  return result.length > 0;
}

/**
 * Single-folder "move" operation. Replaces the recording's folder set
 * with the supplied folder (or clears it if null). Used by the legacy
 * single-folder UI flows on the dashboard and the desktop's
 * `PATCH /api/recordings/:id/folder` endpoint.
 *
 * Phase 1 dual-write: updates BOTH the legacy `media_objects.folder_id`
 * column AND the `media_folder_assignments` join table so reads from
 * either source stay consistent through the migration.
 */
export async function moveRecordingToFolder(params: {
  recordingId: string;
  ownerId: string;
  folderId: string | null;
}): Promise<boolean> {
  const result = await db
    .update(mediaObjects)
    .set({ folderId: params.folderId })
    .where(
      and(
        eq(mediaObjects.id, params.recordingId),
        eq(mediaObjects.ownerId, params.ownerId)
      )
    )
    .returning({ id: mediaObjects.id });
  if (result.length === 0) return false;

  // Mirror to the join table. "Move" semantics → wipe existing
  // assignments, optionally insert the new single one.
  await db
    .delete(mediaFolderAssignments)
    .where(
      and(
        eq(mediaFolderAssignments.mediaObjectId, params.recordingId),
        eq(mediaFolderAssignments.ownerId, params.ownerId)
      )
    );
  if (params.folderId !== null) {
    await db
      .insert(mediaFolderAssignments)
      .values({
        mediaObjectId: params.recordingId,
        folderId: params.folderId,
        ownerId: params.ownerId,
      })
      .onConflictDoNothing();
  }
  return true;
}

/**
 * Phase-1 multi-folder primitive: idempotently add a folder
 * assignment. Does NOT touch `media_objects.folder_id` — the legacy
 * column stays "first folder assigned" semantically and is updated
 * by `moveRecordingToFolder`. Phase 2 readers will go through the
 * join table directly.
 *
 * Returns true if the recording exists and is owned by the caller.
 */
export async function addRecordingToFolder(params: {
  recordingId: string;
  ownerId: string;
  folderId: string;
}): Promise<boolean> {
  // Verify ownership of the recording before inserting (the FK
  // doesn't enforce the owner relationship, RLS does at runtime
  // but we run as service-role here in the server).
  const [recording] = await db
    .select({ id: mediaObjects.id })
    .from(mediaObjects)
    .where(
      and(
        eq(mediaObjects.id, params.recordingId),
        eq(mediaObjects.ownerId, params.ownerId)
      )
    )
    .limit(1);
  if (!recording) return false;
  await db
    .insert(mediaFolderAssignments)
    .values({
      mediaObjectId: params.recordingId,
      folderId: params.folderId,
      ownerId: params.ownerId,
    })
    .onConflictDoNothing();
  return true;
}

/**
 * Phase-1 multi-folder primitive: remove a single folder assignment.
 * Idempotent — removing a nonexistent assignment is a no-op success.
 *
 * Does NOT touch `media_objects.folder_id`. If the assignment being
 * removed happens to match the legacy column, the column stays
 * pointing at a now-detached folder; that's acceptable during the
 * dual-write phase because reads still go through `folder_id`. Phase
 * 2 fixes this by reading from the join table only.
 */
export async function removeRecordingFromFolder(params: {
  recordingId: string;
  ownerId: string;
  folderId: string;
}): Promise<boolean> {
  await db
    .delete(mediaFolderAssignments)
    .where(
      and(
        eq(mediaFolderAssignments.mediaObjectId, params.recordingId),
        eq(mediaFolderAssignments.folderId, params.folderId),
        eq(mediaFolderAssignments.ownerId, params.ownerId)
      )
    );
  return true;
}

/**
 * List the folders a single recording is assigned to (any number,
 * including zero). Caller-side ownership is enforced by joining
 * with `mediaFolderAssignments.ownerId`.
 */
export async function listFoldersForRecording(params: {
  recordingId: string;
  ownerId: string;
}): Promise<Folder[]> {
  return db
    .select({
      id: folders.id,
      ownerId: folders.ownerId,
      parentId: folders.parentId,
      name: folders.name,
      importSource: folders.importSource,
      importSourceId: folders.importSourceId,
      createdAt: folders.createdAt,
      updatedAt: folders.updatedAt,
    })
    .from(mediaFolderAssignments)
    .innerJoin(folders, eq(folders.id, mediaFolderAssignments.folderId))
    .where(
      and(
        eq(mediaFolderAssignments.mediaObjectId, params.recordingId),
        eq(mediaFolderAssignments.ownerId, params.ownerId)
      )
    )
    .orderBy(folders.name);
}

/**
 * Bulk lookup: for a set of recording ids, return a map of
 * recordingId → assigned folders. One round trip; used by list
 * endpoints (Recent strip, dashboard) that need to render multi-
 * folder pills without N+1.
 */
export async function listFolderAssignmentsForRecordings(params: {
  recordingIds: ReadonlyArray<string>;
  ownerId: string;
}): Promise<Map<string, Folder[]>> {
  const result = new Map<string, Folder[]>();
  if (params.recordingIds.length === 0) return result;
  const rows = await db
    .select({
      recordingId: mediaFolderAssignments.mediaObjectId,
      folder: {
        id: folders.id,
        ownerId: folders.ownerId,
        parentId: folders.parentId,
        name: folders.name,
        importSource: folders.importSource,
        importSourceId: folders.importSourceId,
        createdAt: folders.createdAt,
        updatedAt: folders.updatedAt,
      },
    })
    .from(mediaFolderAssignments)
    .innerJoin(folders, eq(folders.id, mediaFolderAssignments.folderId))
    .where(
      and(
        eq(mediaFolderAssignments.ownerId, params.ownerId),
        inArray(mediaFolderAssignments.mediaObjectId, [...params.recordingIds])
      )
    )
    .orderBy(folders.name);
  for (const row of rows) {
    const list = result.get(row.recordingId) ?? [];
    list.push(row.folder);
    result.set(row.recordingId, list);
  }
  return result;
}
