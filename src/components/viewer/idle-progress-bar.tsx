"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export type Chapter = { start_sec: number; title: string };

/**
 * Loom-style idle progress strip. Always rendered as a thin bar at the
 * bottom edge of the Plyr root; fades out when Plyr's controls become
 * visible (so the full seekbar takes over) and fades back in when
 * controls hide. Shows the played portion in the brand accent and
 * chapter boundaries as 1 px dividers.
 *
 * Pure visual / non-interactive — clicking lands on the underlying
 * `<video>` (which Plyr captures to play/pause). Seeking happens via
 * the full Plyr seekbar that appears on hover. Keeping this bar
 * pointer-events: none also avoids stealing Plyr's hover detection.
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

  const progressPct = Math.min(
    100,
    Math.max(0, (currentTime / totalDuration) * 100)
  );

  // Boundaries between chapters. Drop 0 (the start) and >=100 (would
  // sit off the right edge); keep interior dividers.
  const dividers = chapters
    .map((c) => (c.start_sec / totalDuration) * 100)
    .filter((p) => p > 0.1 && p < 99.9);

  return createPortal(
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        height: 3,
        background: "rgba(255, 255, 255, 0.18)",
        opacity: controlsHidden ? 1 : 0,
        transition: "opacity 180ms ease",
        pointerEvents: "none",
        zIndex: 5,
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          height: "100%",
          width: `${progressPct}%`,
          background: accentColor,
          transition: "width 100ms linear",
        }}
      />
      {dividers.map((pct, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            top: 0,
            height: "100%",
            left: `calc(${pct}% - 0.5px)`,
            width: 1,
            background: "rgba(0, 0, 0, 0.55)",
          }}
        />
      ))}
    </div>,
    playerEl
  );
}
