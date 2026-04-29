"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  computeSegments,
  segmentFillPct,
  type Chapter,
} from "./chapter-segments";

const BAR_HEIGHT = 3;
const SEGMENT_GAP = 1;
const TRACK_BG = "rgba(255, 255, 255, 0.18)";

/**
 * Loom-style idle progress strip. Always rendered as a thin bar at the
 * bottom edge of the Plyr root; fades out when Plyr's controls become
 * visible (so the chapter overlay + full seekbar take over) and fades
 * back in when controls hide.
 *
 * Visually matches ChapterSegmentsOverlay (same per-segment gradient
 * fill, same pill rounding) but at a thinner 3 px height so it reads
 * as a peripheral indicator rather than an interactive seekbar.
 *
 * Falls back to a single full-width pill when the recording has no
 * chapters — still draws progress, just no dividers.
 *
 * Pure visual / non-interactive (pointer-events: none) so it doesn't
 * steal Plyr's hover detection that drives controls show/hide.
 */
export function IdleProgressBar({
  playerEl,
  chapters,
  totalDuration,
  currentTime,
  accentColor,
}: {
  playerEl: HTMLElement | null;
  chapters: Chapter[];
  totalDuration: number;
  currentTime: number;
  accentColor: string;
}) {
  const [controlsHidden, setControlsHidden] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!playerEl) return;
    const update = () =>
      setControlsHidden(playerEl.classList.contains("plyr--hide-controls"));
    update();
    const mo = new MutationObserver(update);
    mo.observe(playerEl, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, [playerEl]);

  if (!mounted || !playerEl || totalDuration <= 0) return null;

  const computed = computeSegments(chapters, totalDuration);
  // No-chapter fallback: render a single pill spanning the full duration
  // so progress still draws. Same gradient logic, same pill rounding.
  const segments =
    computed.length > 0
      ? computed
      : [{ leftPct: 0, widthPct: 100, start_sec: 0, title: "" }];

  return createPortal(
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        height: BAR_HEIGHT,
        opacity: controlsHidden ? 1 : 0,
        transition: "opacity 180ms ease",
        pointerEvents: "none",
        display: "flex",
        gap: `${SEGMENT_GAP}px`,
        zIndex: 5,
      }}
    >
      {segments.map((seg, i) => {
        const fillPct = segmentFillPct(seg, totalDuration, currentTime);
        return (
          <div
            key={i}
            style={{
              flex: `${seg.widthPct} 0 0`,
              height: "100%",
              background: `linear-gradient(to right, ${accentColor} ${fillPct}%, ${TRACK_BG} ${fillPct}%)`,
              borderRadius: 9999,
            }}
          />
        );
      })}
    </div>,
    playerEl
  );
}
