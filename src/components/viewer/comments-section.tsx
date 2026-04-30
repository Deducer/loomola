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
  onCommentAdded,
}: {
  comments: CommentRow[];
  slug: string;
  isOwner: boolean;
  onSeek: (sec: number) => void;
  getCurrentTime: () => number;
  onCommentAdded?: (comment: CommentRow) => void;
}) {
  return (
    <div>
      <CommentList comments={comments} isOwner={isOwner} onSeek={onSeek} />
      <CommentForm
        slug={slug}
        getCurrentTime={getCurrentTime}
        onCommentAdded={onCommentAdded}
      />
    </div>
  );
}
