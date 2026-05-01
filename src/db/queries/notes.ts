import { db } from "@/db";
import { mediaObjects, notes } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";

export type Note = typeof notes.$inferSelect;

export async function upsertNotesBody(
  mediaObjectId: string,
  ownerId: string,
  body: string
): Promise<Note> {
  const [media] = await db
    .select({ id: mediaObjects.id, ownerId: mediaObjects.ownerId })
    .from(mediaObjects)
    .where(and(eq(mediaObjects.id, mediaObjectId), eq(mediaObjects.type, "audio")))
    .limit(1);

  if (!media || media.ownerId !== ownerId) {
    throw new Error("media_object_not_found");
  }

  const [row] = await db
    .insert(notes)
    .values({ mediaObjectId, ownerId, body })
    .onConflictDoUpdate({
      target: notes.mediaObjectId,
      set: { body, updatedAt: sql`now()` },
    })
    .returning();

  return row;
}

export async function getNotesByMediaObject(
  mediaObjectId: string,
  ownerId: string
): Promise<Note | null> {
  const [row] = await db
    .select()
    .from(notes)
    .where(
      and(eq(notes.mediaObjectId, mediaObjectId), eq(notes.ownerId, ownerId))
    )
    .limit(1);

  return row ?? null;
}

export async function deleteNotes(
  mediaObjectId: string,
  ownerId: string
): Promise<boolean> {
  const result = await db
    .delete(notes)
    .where(
      and(eq(notes.mediaObjectId, mediaObjectId), eq(notes.ownerId, ownerId))
    )
    .returning({ id: notes.id });

  return result.length > 0;
}
