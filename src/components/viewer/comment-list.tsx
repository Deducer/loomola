"use client";

import { CommentItem } from "./comment-item";

type CommentRow = {
  id: string;
  commenterName: string;
  body: string;
  timestampSec: number;
  createdAt: string;
};

export function CommentList({
  comments,
  isOwner,
  onSeek,
}: {
  comments: CommentRow[];
  isOwner: boolean;
  onSeek: (sec: number) => void;
}) {
  if (comments.length === 0) {
    return (
      <p className="mt-3 text-sm opacity-60">
        No comments yet. Be the first to leave one.
      </p>
    );
  }
  return (
    <ul className="mt-3 space-y-2">
      {comments.map((c) => (
        <CommentItem
          key={c.id}
          id={c.id}
          name={c.commenterName}
          body={c.body}
          timestampSec={c.timestampSec}
          createdAt={new Date(c.createdAt)}
          isOwner={isOwner}
          onSeek={onSeek}
        />
      ))}
    </ul>
  );
}
