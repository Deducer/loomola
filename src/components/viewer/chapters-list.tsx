"use client";

import { Bookmark, ChevronRight } from "lucide-react";

function formatTs(seconds: number): string {
  const s = Math.floor(seconds);
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toString().padStart(2, "0")}`;
}

type Chapter = { start_sec: number; title: string };

export function ChaptersList({
  chapters,
  onSeek,
}: {
  chapters: Chapter[];
  onSeek: (sec: number) => void;
}) {
  if (chapters.length === 0) return null;
  return (
    <section className="mt-10">
      <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
        <Bookmark className="h-3.5 w-3.5" />
        Chapters
        <span className="font-normal normal-case tracking-normal text-text-subtle">
          ({chapters.length})
        </span>
      </h2>
      <ul className="mt-3 space-y-1">
        {chapters.map((c, i) => (
          <li key={i}>
            <button
              type="button"
              onClick={() => onSeek(c.start_sec)}
              className="group flex w-full items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 text-left text-sm text-text-muted transition-all hover:border-border hover:bg-bg-subtle/70 hover:text-text"
            >
              <span className="shrink-0 rounded bg-bg-elevated px-2 py-0.5 font-mono text-[11px] text-text-subtle transition-colors group-hover:bg-accent/15 group-hover:text-accent">
                {formatTs(c.start_sec)}
              </span>
              <span className="flex-1 leading-snug">{c.title}</span>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-subtle opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
