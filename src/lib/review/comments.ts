import type { ReviewAnnotation } from "./annotation";

/** One comment as the share page and the public API see it (no email). */
export type ReviewComment = {
  id: string;
  commenterName: string;
  body: string;
  timestampSec: number;
  endSec: number | null;
  annotation: ReviewAnnotation | null;
  parentId: string | null;
  resolvedAt: string | null;
  createdAt: string;
};

export type CommentThread = ReviewComment & {
  /** 1-based, by time across every top-level comment (resolved included),
   *  so a number never shifts when the filter changes. */
  number: number;
  replies: ReviewComment[];
};

export type CommentFilter = "all" | "open" | "resolved";

type RowLike = {
  id: string;
  commenterName: string;
  body: string;
  timestampSec: string | number;
  endSec: string | number | null;
  annotation: unknown;
  parentId: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
};

export function toReviewComment(row: RowLike): ReviewComment {
  return {
    id: row.id,
    commenterName: row.commenterName,
    body: row.body,
    timestampSec: Number(row.timestampSec),
    endSec: row.endSec == null ? null : Number(row.endSec),
    annotation: (row.annotation as ReviewAnnotation | null) ?? null,
    parentId: row.parentId,
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

function byTime(a: ReviewComment, b: ReviewComment): number {
  return a.timestampSec - b.timestampSec || a.createdAt.localeCompare(b.createdAt);
}

/** Flat rows → numbered top-level threads ordered by time, replies oldest
 *  first underneath. Replies whose parent is missing are dropped. */
export function buildThreads(comments: ReviewComment[]): CommentThread[] {
  const top = comments.filter((c) => !c.parentId).sort(byTime);
  const replies = new Map<string, ReviewComment[]>();
  for (const c of comments) {
    if (!c.parentId) continue;
    const list = replies.get(c.parentId) ?? [];
    list.push(c);
    replies.set(c.parentId, list);
  }
  return top.map((c, i) => ({
    ...c,
    number: i + 1,
    replies: (replies.get(c.id) ?? []).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  }));
}

export function filterThreads(threads: CommentThread[], filter: CommentFilter): CommentThread[] {
  if (filter === "open") return threads.filter((t) => !t.resolvedAt);
  if (filter === "resolved") return threads.filter((t) => !!t.resolvedAt);
  return threads;
}

/** Threads to show as small pins over the playing video: those with an
 *  annotation whose moment is within `window` s of `t`, or whose range
 *  contains `t`. */
export function threadsNearTime(threads: CommentThread[], t: number, window = 0.5): CommentThread[] {
  return threads.filter((c) => {
    if (!c.annotation || c.resolvedAt) return false;
    if (c.endSec != null && t >= c.timestampSec && t <= c.endSec) return true;
    return Math.abs(t - c.timestampSec) <= window;
  });
}

/** Where to draw a thread's number when it has no pin: its first stroke. */
export function annotationAnchor(a: ReviewAnnotation | null): { x: number; y: number } | null {
  if (!a) return null;
  if (a.pin) return a.pin;
  const first = a.strokes?.[0]?.points[0];
  return first ? { x: first[0], y: first[1] } : null;
}

/** Undo the nesting the public API returns. */
export function flattenThreads(
  threads: Array<ReviewComment & { replies?: ReviewComment[] }>
): ReviewComment[] {
  return threads.flatMap(({ replies, ...c }) => [c as ReviewComment, ...(replies ?? [])]);
}
