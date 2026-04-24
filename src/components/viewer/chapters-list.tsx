"use client";

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
    <div className="mt-10">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
        Chapters
      </h2>
      <ul className="mt-3 space-y-1">
        {chapters.map((c, i) => (
          <li key={i}>
            <button
              type="button"
              onClick={() => onSeek(c.start_sec)}
              className="flex w-full items-baseline gap-3 rounded-md px-2 py-1.5 text-left text-sm text-text-muted transition-colors hover:bg-bg-subtle hover:text-text"
            >
              <code className="shrink-0 rounded bg-bg-elevated px-1.5 py-0.5 font-mono text-[11px] text-text-muted">
                {formatTs(c.start_sec)}
              </code>
              <span>{c.title}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
