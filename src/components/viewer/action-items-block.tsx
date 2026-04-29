"use client";

import { Check, ChevronRight, ListChecks } from "lucide-react";

type ActionItem = { timestamp_sec: number; text: string };

function formatTs(seconds: number): string {
  const s = Math.floor(seconds);
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toString().padStart(2, "0")}`;
}

export function ActionItemsBlock({
  actionItems,
  onSeek,
}: {
  actionItems: ActionItem[];
  onSeek: (sec: number) => void;
}) {
  if (actionItems.length === 0) return null;
  return (
    <section className="mt-10">
      <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
        <ListChecks className="h-3.5 w-3.5" />
        Action items
        <span className="font-normal normal-case tracking-normal text-text-subtle">
          ({actionItems.length})
        </span>
      </h2>
      <ul className="mt-3 space-y-1">
        {actionItems.map((item, i) => (
          <li key={i}>
            <button
              type="button"
              onClick={() => onSeek(item.timestamp_sec)}
              className="group flex w-full items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 text-left text-[14px] text-text-muted transition-all hover:border-border hover:bg-bg-subtle/70 hover:text-text"
            >
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-border-strong text-accent transition-colors group-hover:border-accent group-hover:bg-accent/10">
                <Check className="h-3 w-3" />
              </span>
              <span className="flex-1 leading-snug">{item.text}</span>
              <span className="shrink-0 rounded bg-bg-elevated px-2 py-0.5 font-mono text-[11px] text-text-subtle transition-colors group-hover:bg-accent/15 group-hover:text-accent">
                {formatTs(item.timestamp_sec)}
              </span>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-subtle opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
