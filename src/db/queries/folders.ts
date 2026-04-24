import { db } from "@/db";
import { folders, mediaObjects } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";

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
  return result.length > 0;
}
