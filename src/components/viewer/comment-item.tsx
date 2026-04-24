"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

function formatTs(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toString().padStart(2, "0")}`;
}

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
  id: string;
  name: string;
  body: string;
  timestampSec: number;
  createdAt: Date;
  isOwner: boolean;
  onSeek: (sec: number) => void;
};

export function CommentItem({
  id,
  name,
  body,
  timestampSec,
  createdAt,
  isOwner,
  onSeek,
}: Props) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!confirm("Delete this comment?")) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/comments/${id}`, { method: "DELETE" });
      if (!res.ok) {
        alert(`Delete failed (${res.status}).`);
        return;
      }
      router.refresh();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <li className="group flex gap-3 rounded-lg border border-border bg-bg-subtle p-3 text-sm">
      <button
        type="button"
        onClick={() => onSeek(timestampSec)}
        className="shrink-0 self-start rounded bg-bg-elevated px-1.5 py-0.5 font-mono text-[11px] text-text-muted hover:text-text"
      >
        {formatTs(timestampSec)}
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-medium text-text">{name}</span>
          <span className="shrink-0 text-xs text-text-subtle">
            {formatRelative(createdAt)}
          </span>
        </div>
        <p className="mt-1 whitespace-pre-wrap break-words text-text-muted">
          {body}
        </p>
      </div>
      {isOwner && (
        <Button
          variant="ghost"
          size="icon"
          onClick={handleDelete}
          disabled={deleting}
          aria-label="Delete comment"
          className="h-7 w-7 opacity-0 transition-opacity group-hover:opacity-100"
        >
          <X className="h-3.5 w-3.5 text-destructive" />
        </Button>
      )}
    </li>
  );
}
