import { db } from "@/db";
import { comments, mediaObjects } from "@/db/schema";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { ReviewAnnotation } from "@/lib/review/annotation";

export type Comment = typeof comments.$inferSelect;

export async function createComment(params: {
  mediaObjectId: string;
  name: string;
  email: string;
  timestampSec: number;
  body: string;
  endSec?: number | null;
  annotation?: ReviewAnnotation | null;
  parentId?: string | null;
}): Promise<Comment> {
  const [row] = await db
    .insert(comments)
    .values({
      mediaObjectId: params.mediaObjectId,
      commenterName: params.name,
      commenterEmail: params.email,
      timestampSec: String(params.timestampSec),
      body: params.body,
      endSec: params.endSec == null ? null : String(params.endSec),
      annotation: params.annotation ?? null,
      parentId: params.parentId ?? null,
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

/** A top-level comment on this recording, or null (missing, a reply, or
 *  on another recording). Replies may only hang off one of these. */
export async function getTopLevelComment(
  mediaObjectId: string,
  commentId: string
): Promise<Comment | null> {
  const [row] = await db
    .select()
    .from(comments)
    .where(
      and(
        eq(comments.id, commentId),
        eq(comments.mediaObjectId, mediaObjectId),
        isNull(comments.parentId)
      )
    )
    .limit(1);
  return row ?? null;
}

export type ResolveResult = "ok" | "not_found" | "is_reply";

/** Owner-only: set or clear resolved_at on a top-level comment. When
 *  `mediaObjectId` is given the comment must also belong to it (share-page
 *  route, scoped by slug). */
export async function setCommentResolvedOwned(params: {
  commentId: string;
  ownerId: string;
  resolved: boolean;
  mediaObjectId?: string;
}): Promise<{ result: ResolveResult; row?: Comment }> {
  const [found] = await db
    .select({ c: comments, ownerId: mediaObjects.ownerId })
    .from(comments)
    .innerJoin(mediaObjects, eq(comments.mediaObjectId, mediaObjects.id))
    .where(eq(comments.id, params.commentId))
    .limit(1);
  if (!found || found.ownerId !== params.ownerId) return { result: "not_found" };
  if (params.mediaObjectId && found.c.mediaObjectId !== params.mediaObjectId) {
    return { result: "not_found" };
  }
  if (found.c.parentId) return { result: "is_reply" };
  const [row] = await db
    .update(comments)
    .set({ resolvedAt: params.resolved ? new Date() : null })
    .where(eq(comments.id, params.commentId))
    .returning();
  return { result: "ok", row };
}
