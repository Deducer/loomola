"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  groupWordsIntoParagraphs,
  findActiveParagraphIndex,
  type Word,
} from "@/lib/viewer/paragraphs";

export function TranscriptPanel({
  words,
  fullText,
  currentTime,
  onSeek,
}: {
  words: Word[];
  fullText: string;
  currentTime: number;
  onSeek: (sec: number) => void;
}) {
  const paragraphs = useMemo(() => groupWordsIntoParagraphs(words), [words]);
  const activeIdx = useMemo(
    () => findActiveParagraphIndex(paragraphs, currentTime),
    [paragraphs, currentTime]
  );

  const containerRef = useRef<HTMLDivElement | null>(null);
  const paragraphRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (activeIdx < 0) return;
    const el = paragraphRefs.current[activeIdx];
    if (el) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeIdx]);

  if (paragraphs.length === 0) {
    return (
      <div className="mt-10">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
          Transcript
        </h2>
        <p className="mt-3 rounded-xl border border-border bg-bg-subtle p-4 text-sm leading-7 text-text-muted">
          {fullText || "(empty transcript)"}
        </p>
      </div>
    );
  }

  return (
    <div className="mt-10">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
        Transcript
      </h2>
      <div
        ref={containerRef}
        className="mt-3 max-h-96 overflow-y-auto rounded-xl border border-border bg-bg-subtle p-2"
      >
        {paragraphs.map((p, i) => (
          <button
            key={i}
            type="button"
            ref={(el) => {
              paragraphRefs.current[i] = el;
            }}
            onClick={() => onSeek(p.startSec)}
            className={`block w-full rounded-md px-3 py-2 text-left text-sm leading-7 transition-colors ${
              i === activeIdx
                ? "bg-accent/10 text-text"
                : "text-text-muted hover:bg-bg-elevated hover:text-text"
            }`}
          >
            {p.text}
          </button>
        ))}
      </div>
    </div>
  );
}
