import { db } from "@/db";
import { mediaObjects, notes, transcripts } from "@/db/schema";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { generateSlug } from "@/lib/slug";

export type Note = typeof notes.$inferSelect;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuidIdentifier(value: string): boolean {
  return UUID_RE.test(value);
}

export type AudioNotePageData = {
  media: typeof mediaObjects.$inferSelect;
  note: Note | null;
  transcript: typeof transcripts.$inferSelect | null;
};

export async function createQuickAudioNote(ownerId: string): Promise<{
  id: string;
  slug: string;
}> {
  const [row] = await db
    .insert(mediaObjects)
    .values({
      ownerId,
      type: "audio",
      slug: generateSlug(),
      status: "ready",
    })
    .returning({ id: mediaObjects.id, slug: mediaObjects.slug });

  return row;
}

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

export async function getAudioNotePageData(
  identifier: string,
  ownerId: string
): Promise<AudioNotePageData | null> {
  const mediaWhere = isUuidIdentifier(identifier)
    ? or(eq(mediaObjects.id, identifier), eq(mediaObjects.slug, identifier))
    : eq(mediaObjects.slug, identifier);

  const [row] = await db
    .select({
      media: mediaObjects,
      note: notes,
      transcript: transcripts,
    })
    .from(mediaObjects)
    .leftJoin(notes, eq(notes.mediaObjectId, mediaObjects.id))
    .leftJoin(transcripts, eq(transcripts.mediaObjectId, mediaObjects.id))
    .where(
      and(
        mediaWhere,
        eq(mediaObjects.ownerId, ownerId),
        eq(mediaObjects.type, "audio"),
        isNull(mediaObjects.deletedAt)
      )
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
