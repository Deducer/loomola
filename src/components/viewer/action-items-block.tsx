"use client";

import { Check } from "lucide-react";

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
    <section className="mt-8">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-text-subtle">
        Action items
      </h2>
      <ul className="mt-3 space-y-1.5">
        {actionItems.map((item, i) => (
          <li key={i}>
            <button
              type="button"
              onClick={() => onSeek(item.timestamp_sec)}
              className="flex w-full items-baseline gap-3 rounded-md px-2 py-1.5 text-left text-[14px] text-text-muted transition-colors hover:bg-bg-subtle hover:text-text"
            >
              <Check className="h-3.5 w-3.5 shrink-0 translate-y-0.5 text-accent" />
              <span className="flex-1">{item.text}</span>
              <code className="shrink-0 rounded bg-bg-elevated px-1.5 py-0.5 font-mono text-[11px] text-text-subtle">
                {formatTs(item.timestamp_sec)}
              </code>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
