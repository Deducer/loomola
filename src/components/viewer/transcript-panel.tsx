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
      <div className="mt-8">
        <h2 className="text-sm font-medium">Transcript</h2>
        <p className="mt-3 rounded-lg border border-white/10 p-4 text-sm leading-relaxed opacity-80">
          {fullText || "(empty transcript)"}
        </p>
      </div>
    );
  }

  return (
    <div className="mt-8">
      <h2 className="text-sm font-medium">Transcript</h2>
      <div
        ref={containerRef}
        className="mt-3 max-h-96 overflow-y-auto rounded-lg border border-white/10 p-2"
      >
        {paragraphs.map((p, i) => (
          <button
            key={i}
            ref={(el) => {
              paragraphRefs.current[i] = el;
            }}
            onClick={() => onSeek(p.startSec)}
            className={`block w-full rounded px-2 py-2 text-left text-sm leading-relaxed transition-colors ${
              i === activeIdx
                ? "bg-white/10"
                : "opacity-70 hover:bg-white/5 hover:opacity-100"
            }`}
          >
            {p.text}
          </button>
        ))}
      </div>
    </div>
  );
}
