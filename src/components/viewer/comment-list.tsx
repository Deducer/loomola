"use client";

import { MessageSquare } from "lucide-react";
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
      <div className="mt-3 rounded-xl border border-dashed border-border bg-bg-subtle/40 p-8 text-center">
        <MessageSquare className="mx-auto h-5 w-5 text-text-subtle" />
        <p className="mt-2 text-sm text-text-subtle">
          No comments yet — be the first to leave one below.
        </p>
      </div>
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
