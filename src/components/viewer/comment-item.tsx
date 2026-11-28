"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, PenLine, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { formatTimecode } from "@/lib/review/frames";
import type { CommentThread, ReviewComment } from "@/lib/review/comments";
import { CommentForm } from "./comment-form";

function formatRelative(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}

type Props = {
  thread: CommentThread;
  slug: string;
  fps: number | null;
  isOwner: boolean;
  active: boolean;
  canReply: boolean;
  onSelect: (thread: CommentThread) => void;
  onCommentAdded: (comment: ReviewComment) => void;
  onCommentChanged: (comment: ReviewComment) => void;
  getCurrentTime: () => number;
};

/** Owner-only two-tap delete (same pattern as the bulk-select bar). */
function useDelete(id: string) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  async function handleDelete() {
    if (!confirming) {
      setConfirming(true);
      window.setTimeout(() => setConfirming(false), 3000);
      return;
    }
    setConfirming(false);
    setDeleting(true);
    try {
      const res = await fetch(`/api/comments/${id}`, { method: "DELETE" });
      if (!res.ok) {
        toast.error(`Delete failed (${res.status}).`);
        return;
      }
      router.refresh();
    } finally {
      setDeleting(false);
    }
  }
  return { deleting, confirming, handleDelete };
}

function DeleteButton({ id }: { id: string }) {
  const { deleting, confirming, handleDelete } = useDelete(id);
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={(e) => {
        e.stopPropagation();
        void handleDelete();
      }}
      disabled={deleting}
      aria-label={confirming ? "Confirm delete comment" : "Delete comment"}
      title={confirming ? "Click again to delete" : "Delete comment"}
      className={cn(
        "h-7 w-7 transition-opacity group-hover:opacity-100",
        confirming ? "bg-destructive/15 opacity-100" : "opacity-0"
      )}
    >
      <X className="h-3.5 w-3.5 text-destructive" />
    </Button>
  );
}

export function CommentItem({
  thread,
  slug,
  fps,
  isOwner,
  active,
  canReply,
  onSelect,
  onCommentAdded,
  onCommentChanged,
  getCurrentTime,
}: Props) {
  const router = useRouter();
  const [replying, setReplying] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [resolving, setResolving] = useState(false);
  const resolved = !!thread.resolvedAt;
  const collapsed = resolved && !expanded;
  const time =
    formatTimecode(thread.timestampSec, fps) +
    (thread.endSec != null ? `–${formatTimecode(thread.endSec, fps)}` : "");

  async function toggleResolved(e: React.MouseEvent) {
    e.stopPropagation();
    setResolving(true);
    try {
      const res = await fetch(`/api/v/${slug}/comments/${thread.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resolved: !resolved }),
      });
      if (!res.ok) {
        toast.error(`Couldn't update (${res.status}).`);
        return;
      }
      const data = (await res.json()) as { comment: ReviewComment };
      onCommentChanged(data.comment);
      router.refresh();
    } finally {
      setResolving(false);
    }
  }

  if (collapsed) {
    return (
      <li className="group flex items-center gap-2 rounded-xl border border-border/60 bg-bg-subtle/30 px-3 py-2 text-xs text-text-subtle">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-bg-elevated font-mono text-[10px] tabular-nums">
          {thread.number}
        </span>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="min-w-0 flex-1 truncate text-left hover:text-text"
          title="Show resolved comment"
        >
          <Check className="mr-1 inline h-3 w-3 text-emerald-500" />
          {thread.commenterName}: {thread.body}
        </button>
        <span className="font-mono text-[11px]">{time}</span>
      </li>
    );
  }

  return (
    <li
      className={cn(
        "group rounded-xl border bg-bg-subtle/60 p-3.5 text-sm transition-colors",
        active ? "border-accent/60 bg-accent/5" : "border-border",
        resolved && "opacity-80"
      )}
    >
      <div className="flex gap-3">
        <div className="relative mt-0.5 shrink-0">
          <Avatar name={thread.commenterName} size={32} />
          <span
            className="absolute -bottom-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 font-mono text-[9px] font-bold tabular-nums text-white ring-2 ring-bg-subtle"
            style={{ background: "var(--accent)" }}
            aria-label={`Comment ${thread.number}`}
          >
            {thread.number}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="truncate font-medium text-text">{thread.commenterName}</span>
            <span
              className="text-xs text-text-subtle"
              title={new Date(thread.createdAt).toLocaleString()}
            >
              {formatRelative(new Date(thread.createdAt))}
            </span>
            <button
              type="button"
              onClick={() => onSelect(thread)}
              className="ml-auto inline-flex shrink-0 items-center gap-1 rounded bg-bg-elevated px-1.5 py-0.5 font-mono text-[11px] text-text-muted transition-colors hover:bg-accent/15 hover:text-accent"
              aria-label={`Jump to ${time}`}
            >
              {thread.annotation && <PenLine className="h-3 w-3" aria-label="has a drawing" />}
              {time}
            </button>
          </div>
          <p className="mt-1 whitespace-pre-wrap break-words leading-relaxed text-text-muted">
            {thread.body}
          </p>
          <div className="mt-1.5 flex items-center gap-3 text-xs text-text-subtle">
            {canReply && (
              <button type="button" onClick={() => setReplying((r) => !r)} className="hover:text-text">
                Reply
              </button>
            )}
            {resolved && (
              <button type="button" onClick={() => setExpanded(false)} className="hover:text-text">
                Collapse
              </button>
            )}
          </div>
        </div>
        {isOwner && (
          <div className="flex shrink-0 flex-col items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleResolved}
              disabled={resolving}
              aria-label={resolved ? "Reopen comment" : "Resolve comment"}
              title={resolved ? "Reopen" : "Resolve"}
              className={cn("h-7 w-7", resolved && "text-emerald-500")}
            >
              {resolved ? <RotateCcw className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
            </Button>
            <DeleteButton id={thread.id} />
          </div>
        )}
      </div>
      {(thread.replies.length > 0 || replying) && (
        <ul className="ml-11 mt-3 space-y-2 border-l border-border pl-3">
          {thread.replies.map((r) => (
            <li key={r.id} className="group flex gap-2">
              <Avatar name={r.commenterName} size={22} className="mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="truncate text-xs font-medium text-text">{r.commenterName}</span>
                  <span className="text-[11px] text-text-subtle">{formatRelative(new Date(r.createdAt))}</span>
                </div>
                <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-text-muted">
                  {r.body}
                </p>
              </div>
              {isOwner && <DeleteButton id={r.id} />}
            </li>
          ))}
          {replying && (
            <li>
              <CommentForm
                slug={slug}
                fps={fps}
                currentTime={thread.timestampSec}
                getCurrentTime={getCurrentTime}
                parentId={thread.id}
                onCommentAdded={onCommentAdded}
                onCancel={() => setReplying(false)}
              />
            </li>
          )}
        </ul>
      )}
    </li>
  );
}
