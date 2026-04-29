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
    const container = containerRef.current;
    const el = paragraphRefs.current[activeIdx];
    if (!container || !el) return;
    // Scroll only the transcript container — never the document. Element.scrollIntoView
    // walks every ancestor scroll container including <html>, which yanks the share
    // page away from the player every time the active paragraph changes.
    const containerRect = container.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    if (elRect.top >= containerRect.top && elRect.bottom <= containerRect.bottom) return;
    const targetTop = container.scrollTop + (elRect.top - containerRect.top);
    container.scrollTo({ top: targetTop, behavior: "smooth" });
  }, [activeIdx]);

  if (paragraphs.length === 0) {
    return (
      <p className="rounded-xl border border-border bg-bg-subtle/60 p-4 text-sm leading-7 text-text-muted">
        {fullText || "(empty transcript)"}
      </p>
    );
  }

  return (
    <div>
      <div
        ref={containerRef}
        className="max-h-96 overflow-y-auto rounded-xl border border-border bg-bg-subtle/60 p-2"
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
