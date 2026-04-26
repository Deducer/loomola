"use client";

import { useEffect, useState } from "react";

export type Chapter = { start_sec: number; title: string };

export type Segment = {
  leftPct: number;
  widthPct: number;
  start_sec: number;
  title: string;
};

export function computeSegments(
  chapters: Chapter[],
  totalDuration: number
): Segment[] {
  if (totalDuration <= 0 || chapters.length === 0) return [];
  const sorted = [...chapters].sort((a, b) => a.start_sec - b.start_sec);
  const segs: Segment[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = Math.min(sorted[i].start_sec, totalDuration);
    const end = i + 1 < sorted.length
      ? Math.min(sorted[i + 1].start_sec, totalDuration)
      : totalDuration;
    const widthPct = ((end - start) / totalDuration) * 100;
    if (widthPct <= 0) continue;
    segs.push({
      leftPct: (start / totalDuration) * 100,
      widthPct,
      start_sec: sorted[i].start_sec,
      title: sorted[i].title,
    });
  }
  return segs;
}

type OverlayProps = {
  progressEl: HTMLElement | null;
  chapters: Chapter[];
  totalDuration: number;
  currentTime: number;
  onSeek: (sec: number) => void;
};

/**
 * Paints chapter segments on top of Plyr's `.plyr__progress` element.
 * Renders a list of absolutely-positioned buttons, one per segment.
 * `progressEl` is the element returned by Plyr; we apply our overlay
 * via React portal-style positioning (we keep our own wrapper div
 * mounted as a sibling, sized to match).
 */
export function ChapterSegmentsOverlay({
  progressEl,
  chapters,
  totalDuration,
  currentTime,
  onSeek,
}: OverlayProps) {
  const [, forceTick] = useState(0);

  // Re-measure on resize so segments stay aligned with Plyr's progress bar.
  useEffect(() => {
    if (!progressEl) return;
    const onResize = () => forceTick((n) => n + 1);
    window.addEventListener("resize", onResize);
    const ro = new ResizeObserver(onResize);
    ro.observe(progressEl);
    return () => {
      window.removeEventListener("resize", onResize);
      ro.disconnect();
    };
  }, [progressEl]);

  if (!progressEl || totalDuration <= 0) return null;
  const segments = computeSegments(chapters, totalDuration);
  if (segments.length === 0) return null;

  const rect = progressEl.getBoundingClientRect();

  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        top: rect.top + window.scrollY,
        left: rect.left + window.scrollX,
        width: rect.width,
        height: rect.height,
        pointerEvents: "none",
        display: "flex",
        gap: "1px",
      }}
    >
      {segments.map((seg, i) => {
        const segEnd = seg.start_sec + (seg.widthPct / 100) * totalDuration;
        const played = currentTime >= segEnd;
        const current =
          currentTime >= seg.start_sec && currentTime < segEnd;
        return (
          <button
            key={i}
            type="button"
            onClick={() => onSeek(seg.start_sec)}
            title={seg.title}
            style={{
              flex: `${seg.widthPct} 0 0`,
              height: "100%",
              background: played
                ? "var(--accent)"
                : current
                ? "color-mix(in srgb, var(--accent) 70%, transparent)"
                : "rgba(255,255,255,0.20)",
              border: "none",
              padding: 0,
              cursor: "pointer",
              pointerEvents: "auto",
              borderRadius: "1px",
            }}
            aria-label={`Chapter: ${seg.title}`}
          />
        );
      })}
    </div>
  );
}
