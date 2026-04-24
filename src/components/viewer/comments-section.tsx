"use client";

import { CommentList } from "./comment-list";
import { CommentForm } from "./comment-form";

type CommentRow = {
  id: string;
  commenterName: string;
  body: string;
  timestampSec: number;
  createdAt: string;
};

export function CommentsSection({
  comments,
  slug,
  isOwner,
  onSeek,
  getCurrentTime,
}: {
  comments: CommentRow[];
  slug: string;
  isOwner: boolean;
  onSeek: (sec: number) => void;
  getCurrentTime: () => number;
}) {
  return (
    <div className="mt-10">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
        Comments{" "}
        {comments.length > 0 && (
          <span className="text-text-subtle normal-case tracking-normal">
            ({comments.length})
          </span>
        )}
      </h2>
      <CommentList comments={comments} isOwner={isOwner} onSeek={onSeek} />
      <CommentForm slug={slug} getCurrentTime={getCurrentTime} />
    </div>
  );
}
