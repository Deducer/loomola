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
  showForm = true,
}: {
  comments: CommentRow[];
  slug: string;
  isOwner: boolean;
  onSeek: (sec: number) => void;
  getCurrentTime: () => number;
  onCommentAdded?: (comment: CommentRow) => void;
  showForm?: boolean;
}) {
  return (
    <div>
      <CommentList
        comments={comments}
        isOwner={isOwner}
        onSeek={onSeek}
        emptyMessage={
          showForm
            ? undefined
            : "No comments yet. Viewer comments will appear here."
        }
      />
      {showForm && (
        <CommentForm
          slug={slug}
          getCurrentTime={getCurrentTime}
          onCommentAdded={onCommentAdded}
        />
      )}
    </div>
  );
}
