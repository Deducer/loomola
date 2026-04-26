"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

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
 *
 * The overlay is portaled to `document.body` so its `position: fixed`
 * coordinates align with the viewport regardless of any positioned or
 * sticky ancestor in the player tree (e.g. fullscreen, the edit page's
 * sticky preview column, etc.). We use viewport-relative `fixed` (not
 * page-absolute `absolute`) so scrolling doesn't drift the overlay off
 * the seekbar.
 */
export function ChapterSegmentsOverlay({
  progressEl,
  chapters,
  totalDuration,
  currentTime,
  onSeek,
}: OverlayProps) {
  const [, forceTick] = useState(0);
  const [mounted, setMounted] = useState(false);

  // Wait for client-side mount before reading the DOM (Next.js may SSR
  // this component even with "use client", and `document` is undefined
  // server-side).
  useEffect(() => {
    setMounted(true);
  }, []);

  // Re-render whenever the progress bar's position or size could have
  // changed: window resize, scroll, or the element itself resizes.
  useEffect(() => {
    if (!progressEl) return;
    const onChange = () => forceTick((n) => n + 1);
    window.addEventListener("resize", onChange);
    window.addEventListener("scroll", onChange, true /* capture: catch nested scrollers */);
    const ro = new ResizeObserver(onChange);
    ro.observe(progressEl);
    return () => {
      window.removeEventListener("resize", onChange);
      window.removeEventListener("scroll", onChange, true);
      ro.disconnect();
    };
  }, [progressEl]);

  if (!mounted || !progressEl || totalDuration <= 0) return null;
  const segments = computeSegments(chapters, totalDuration);
  if (segments.length === 0) return null;

  const rect = progressEl.getBoundingClientRect();

  const overlay = (
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
        pointerEvents: "none",
        display: "flex",
        gap: "1px",
        zIndex: 10,
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

  return createPortal(overlay, document.body);
}
