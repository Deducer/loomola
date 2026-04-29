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

/** Fraction (0..100) of THIS segment that's been played. Used to draw a
 *  gradient fill inside the segment so the currently-playing chapter
 *  shows smooth progress instead of a hard half-color. */
export function segmentFillPct(
  seg: Segment,
  totalDuration: number,
  currentTime: number
): number {
  const segLength = (seg.widthPct / 100) * totalDuration;
  if (segLength <= 0) return 0;
  const elapsed = Math.max(0, Math.min(segLength, currentTime - seg.start_sec));
  return (elapsed / segLength) * 100;
}

type OverlayProps = {
  progressEl: HTMLElement | null;
  chapters: Chapter[];
  totalDuration: number;
  currentTime: number;
  onSeek: (sec: number) => void;
};

const BAR_HEIGHT = 4;
const SEGMENT_GAP = 2;
const TRACK_BG = "rgba(255, 255, 255, 0.18)";

/**
 * Paints chapter segments on top of Plyr's `.plyr__progress` element when
 * the player's controls are visible. Renders thin pill-shaped segments
 * (4 px tall, 2 px gaps, fully rounded ends) — Loom-style — instead of
 * full-height filled chunks.
 *
 * Each segment shows a gradient from accent (played portion of *this*
 * segment) to a subtle track color (unplayed portion). The currently-
 * playing segment animates its fill smoothly as time advances.
 *
 * Portaled to `document.body` so its `position: fixed` coords align with
 * the viewport regardless of any positioned ancestor (fullscreen, sticky
 * preview columns, etc.). Hidden when controls are hidden — the
 * IdleProgressBar component takes over for the idle state.
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
  const [controlsHidden, setControlsHidden] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!progressEl) return;
    const onChange = () => forceTick((n) => n + 1);
    window.addEventListener("resize", onChange);
    window.addEventListener("scroll", onChange, true);
    const ro = new ResizeObserver(onChange);
    ro.observe(progressEl);
    return () => {
      window.removeEventListener("resize", onChange);
      window.removeEventListener("scroll", onChange, true);
      ro.disconnect();
    };
  }, [progressEl]);

  useEffect(() => {
    if (!progressEl) return;
    const playerRoot = progressEl.closest(".plyr");
    if (!playerRoot) return;
    const update = () =>
      setControlsHidden(playerRoot.classList.contains("plyr--hide-controls"));
    update();
    const mo = new MutationObserver(update);
    mo.observe(playerRoot, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, [progressEl]);

  if (!mounted || !progressEl || totalDuration <= 0 || controlsHidden) return null;
  const segments = computeSegments(chapters, totalDuration);
  if (segments.length === 0) return null;

  const rect = progressEl.getBoundingClientRect();
  // Center the thin bar vertically inside whatever height Plyr's progress
  // element happens to be — works in compact and full-ui modes.
  const top = rect.top + (rect.height - BAR_HEIGHT) / 2;

  const overlay = (
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        top,
        left: rect.left,
        width: rect.width,
        height: BAR_HEIGHT,
        pointerEvents: "none",
        display: "flex",
        gap: `${SEGMENT_GAP}px`,
        zIndex: 10,
      }}
    >
      {segments.map((seg, i) => {
        const fillPct = segmentFillPct(seg, totalDuration, currentTime);
        return (
          <button
            key={i}
            type="button"
            onClick={() => onSeek(seg.start_sec)}
            title={seg.title}
            style={{
              flex: `${seg.widthPct} 0 0`,
              height: "100%",
              background: `linear-gradient(to right, var(--accent) ${fillPct}%, ${TRACK_BG} ${fillPct}%)`,
              border: "none",
              padding: 0,
              cursor: "pointer",
              pointerEvents: "auto",
              borderRadius: 9999,
            }}
            aria-label={`Chapter: ${seg.title}`}
          />
        );
      })}
    </div>
  );

  return createPortal(overlay, document.body);
}
