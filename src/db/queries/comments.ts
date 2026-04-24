import { db } from "@/db";
import { comments, mediaObjects } from "@/db/schema";
import { asc, eq } from "drizzle-orm";

export type Comment = typeof comments.$inferSelect;

export async function createComment(params: {
  mediaObjectId: string;
  name: string;
  email: string;
  timestampSec: number;
  body: string;
}): Promise<Comment> {
  const [row] = await db
    .insert(comments)
    .values({
      mediaObjectId: params.mediaObjectId,
      commenterName: params.name,
      commenterEmail: params.email,
      timestampSec: String(params.timestampSec),
      body: params.body,
    })
    .returning();
  return row;
}

export async function listCommentsForRecording(
  mediaObjectId: string
): Promise<Comment[]> {
  return db
    .select()
    .from(comments)
    .where(eq(comments.mediaObjectId, mediaObjectId))
    .orderBy(asc(comments.createdAt));
}

/**
 * Deletes a comment iff the caller owns the underlying recording.
 * Returns true if a row was deleted, false otherwise (comment missing,
 * recording missing, or wrong owner — all collapse to "not found").
 */
export async function deleteCommentOwned(params: {
  commentId: string;
  ownerId: string;
}): Promise<boolean> {
  const [row] = await db
    .select({ commentId: comments.id, ownerId: mediaObjects.ownerId })
    .from(comments)
    .innerJoin(mediaObjects, eq(comments.mediaObjectId, mediaObjects.id))
    .where(eq(comments.id, params.commentId))
    .limit(1);

  if (!row || row.ownerId !== params.ownerId) return false;

  const result = await db
    .delete(comments)
    .where(eq(comments.id, params.commentId))
    .returning({ id: comments.id });
  return result.length > 0;
}
