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
    <div className="mt-8">
      <h2 className="text-sm font-medium">
        Comments{" "}
        {comments.length > 0 && (
          <span className="opacity-60">({comments.length})</span>
        )}
      </h2>
      <CommentList comments={comments} isOwner={isOwner} onSeek={onSeek} />
      <CommentForm slug={slug} getCurrentTime={getCurrentTime} />
    </div>
  );
}
