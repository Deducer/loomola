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
    <div className="mt-8">
      <h2 className="text-sm font-medium">Chapters</h2>
      <ul className="mt-2 space-y-1">
        {chapters.map((c, i) => (
          <li key={i}>
            <button
              onClick={() => onSeek(c.start_sec)}
              className="flex w-full items-baseline gap-3 rounded px-2 py-1 text-left text-sm hover:bg-white/5"
            >
              <code className="shrink-0 rounded bg-white/5 px-1.5 py-0.5 font-mono text-xs opacity-80">
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
