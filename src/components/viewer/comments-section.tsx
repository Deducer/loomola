"use client";

import type { CommentFilter, CommentThread, ReviewComment } from "@/lib/review/comments";
import type { DrawTool } from "./annotation-overlay";
import { CommentList } from "./comment-list";
import { CommentForm } from "./comment-form";
import type { ReviewDraft } from "./review-draft";

export function CommentsSection({
  threads,
  slug,
  fps,
  isOwner,
  filter,
  onFilterChange,
  activeId,
  onSelect,
  currentTime,
  getCurrentTime,
  onCommentAdded,
  onCommentChanged,
  draft,
  onDraftChange,
  onToolChange,
  onShowDraft,
  showForm = true,
}: {
  threads: CommentThread[];
  slug: string;
  fps: number | null;
  isOwner: boolean;
  filter: CommentFilter;
  onFilterChange: (f: CommentFilter) => void;
  activeId: string | null;
  onSelect: (thread: CommentThread) => void;
  currentTime: number;
  getCurrentTime: () => number;
  onCommentAdded: (comment: ReviewComment) => void;
  onCommentChanged: (comment: ReviewComment) => void;
  draft: ReviewDraft;
  onDraftChange: (next: ReviewDraft) => void;
  onToolChange: (tool: DrawTool | null) => void;
  onShowDraft: () => void;
  showForm?: boolean;
}) {
  return (
    <div>
      <CommentList
        threads={threads}
        slug={slug}
        fps={fps}
        isOwner={isOwner}
        filter={filter}
        onFilterChange={onFilterChange}
        activeId={activeId}
        // The edit page has no composer; the owner still replies there.
        canReply
        onSelect={onSelect}
        onCommentAdded={onCommentAdded}
        onCommentChanged={onCommentChanged}
        getCurrentTime={getCurrentTime}
        emptyMessage={
          showForm ? undefined : "No comments yet. Viewer comments will appear here."
        }
      />
      {showForm && (
        <CommentForm
          slug={slug}
          fps={fps}
          currentTime={currentTime}
          getCurrentTime={getCurrentTime}
          onCommentAdded={onCommentAdded}
          draft={draft}
          onDraftChange={onDraftChange}
          onToolChange={onToolChange}
          onShowDraft={onShowDraft}
        />
      )}
    </div>
  );
}
