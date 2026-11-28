"use client";

import { MessageSquare } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  filterThreads,
  type CommentFilter,
  type CommentThread,
  type ReviewComment,
} from "@/lib/review/comments";
import { CommentItem } from "./comment-item";

const FILTERS: Array<{ key: CommentFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "open", label: "Open" },
  { key: "resolved", label: "Resolved" },
];

export function CommentList({
  threads,
  slug,
  fps,
  isOwner,
  filter,
  onFilterChange,
  activeId,
  canReply,
  onSelect,
  onCommentAdded,
  onCommentChanged,
  getCurrentTime,
  emptyMessage = "No comments yet — be the first to leave one below.",
}: {
  threads: CommentThread[];
  slug: string;
  fps: number | null;
  isOwner: boolean;
  filter: CommentFilter;
  onFilterChange: (f: CommentFilter) => void;
  activeId: string | null;
  canReply: boolean;
  onSelect: (thread: CommentThread) => void;
  onCommentAdded: (comment: ReviewComment) => void;
  onCommentChanged: (comment: ReviewComment) => void;
  getCurrentTime: () => number;
  emptyMessage?: string;
}) {
  if (threads.length === 0) {
    return (
      <div className="mt-3 rounded-xl border border-dashed border-border bg-bg-subtle/40 p-8 text-center">
        <MessageSquare className="mx-auto h-5 w-5 text-text-subtle" />
        <p className="mt-2 text-sm text-text-subtle">{emptyMessage}</p>
      </div>
    );
  }
  const counts = {
    all: threads.length,
    open: threads.filter((t) => !t.resolvedAt).length,
    resolved: threads.filter((t) => !!t.resolvedAt).length,
  };
  const shown = filterThreads(threads, filter);
  return (
    <div className="mt-3">
      <div role="radiogroup" aria-label="Filter comments" className="mb-2 flex gap-1 text-xs">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            role="radio"
            aria-checked={filter === f.key}
            onClick={() => onFilterChange(f.key)}
            className={cn(
              "rounded-full px-2.5 py-1 text-text-muted transition-colors hover:text-text",
              filter === f.key && "bg-bg-elevated text-text"
            )}
          >
            {f.label}
            <span className="ml-1 font-mono text-[10px] tabular-nums text-text-subtle">{counts[f.key]}</span>
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-text-subtle">
          {filter === "resolved" ? "Nothing resolved yet." : "Everything is resolved."}
        </p>
      ) : (
        <ul className="space-y-2">
          {shown.map((t) => (
            <CommentItem
              key={t.id}
              thread={t}
              slug={slug}
              fps={fps}
              isOwner={isOwner}
              active={activeId === t.id}
              canReply={canReply}
              onSelect={onSelect}
              onCommentAdded={onCommentAdded}
              onCommentChanged={onCommentChanged}
              getCurrentTime={getCurrentTime}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
