"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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
    <li className="flex gap-3 rounded border border-white/10 p-3 text-sm">
      <button
        onClick={() => onSeek(timestampSec)}
        className="shrink-0 self-start rounded bg-white/5 px-1.5 py-0.5 font-mono text-xs opacity-80 hover:bg-white/10"
      >
        {formatTs(timestampSec)}
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-medium">{name}</span>
          <span className="shrink-0 text-xs opacity-50">
            {formatRelative(createdAt)}
          </span>
        </div>
        <p className="mt-1 whitespace-pre-wrap break-words opacity-90">{body}</p>
      </div>
      {isOwner && (
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="shrink-0 self-start rounded px-2 py-1 text-xs text-red-300 hover:bg-red-500/20 disabled:opacity-50"
          aria-label="Delete comment"
        >
          ✕
        </button>
      )}
    </li>
  );
}
