"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  computeSegments,
  segmentFillPct,
  type Chapter,
} from "./chapter-segments";

const TRACK_BG = "rgba(255, 255, 255, 0.18)";
const BUFFERED_BG = "rgba(255, 255, 255, 0.32)";
const HIT_HEIGHT = 16; // larger than the visible bar so the click target is forgiving
const HEIGHT_IDLE = 3;
const HEIGHT_HOVER = 6;

/**
 * Loom-style unified seekbar.
 *
 * Pinned to the bottom edge of the Plyr root at all times. Renders as
 * a thin (3 px) line when controls are idle and grows to 6 px with a
 * scrubber thumb when the user hovers (or drags). Click anywhere on
 * the bar to seek; pointerdown + drag scrubs continuously thanks to
 * setPointerCapture, so the gesture survives the cursor leaving the
 * bar's vertical bounds.
 *
 * Replaces Plyr's built-in `.plyr__progress` (hidden via globals.css).
 * The chapter-divider visualization and per-segment gradient fill
 * we used to split between IdleProgressBar + ChapterSegmentsOverlay
 * are unified here — one bar, one component, one set of states.
 *
 * Buffered indicator reads from `<video>.buffered` directly so we
 * don't lose the affordance Plyr was providing for free.
 */
export function Seekbar({
  playerEl,
  videoEl,
  chapters,
  totalDuration,
  currentTime,
  accentColor,
  onSeek,
  onBarElementChange,
}: {
  playerEl: HTMLElement | null;
  videoEl: HTMLVideoElement | null;
  chapters: Chapter[];
  totalDuration: number;
  currentTime: number;
  accentColor: string;
  onSeek: (sec: number) => void;
  /** Called whenever the visible bar's DOM element mounts/unmounts.
   *  The parent uses this to anchor overlays (comment markers, etc.)
   *  to the bar's bounding rect. */
  onBarElementChange?: (el: HTMLElement | null) => void;
}) {
  const hitRef = useRef<HTMLDivElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const [mounted, setMounted] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [bufferedEnd, setBufferedEnd] = useState(0);

  // Callback ref so parent learns when the bar actually mounts (the
  // useImperativeHandle path didn't notify because the handle object
  // was created stable on first render, before the bar element existed).
  const setBarRef = useCallback(
    (el: HTMLDivElement | null) => {
      barRef.current = el;
      onBarElementChange?.(el);
    },
    [onBarElementChange]
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  // Reflect Plyr's controls show/hide state — the bar grows when
  // controls are visible (hover or paused) and shrinks when they fade.
  useEffect(() => {
    if (!playerEl) return;
    const update = () =>
      setControlsVisible(!playerEl.classList.contains("plyr--hide-controls"));
    update();
    const mo = new MutationObserver(update);
    mo.observe(playerEl, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, [playerEl]);

  // Track how far the video has buffered (Plyr's progress bar used to
  // show this). Updated on `progress` events and on each timeupdate as
  // a backstop for streams where `progress` doesn't fire reliably.
  useEffect(() => {
    if (!videoEl) return;
    const update = () => {
      const b = videoEl.buffered;
      if (b.length === 0) {
        setBufferedEnd(0);
        return;
      }
      // Use the buffered range that contains (or is closest to)
      // the current playhead — covers the common case of a single
      // contiguous range starting at 0.
      let end = 0;
      for (let i = 0; i < b.length; i++) {
        end = Math.max(end, b.end(i));
      }
      setBufferedEnd(end);
    };
    update();
    videoEl.addEventListener("progress", update);
    videoEl.addEventListener("timeupdate", update);
    videoEl.addEventListener("loadedmetadata", update);
    return () => {
      videoEl.removeEventListener("progress", update);
      videoEl.removeEventListener("timeupdate", update);
      videoEl.removeEventListener("loadedmetadata", update);
    };
  }, [videoEl]);

  if (!mounted || !playerEl || totalDuration <= 0) return null;

  const computed = computeSegments(chapters, totalDuration);
  const segments =
    computed.length > 0
      ? computed
      : [{ leftPct: 0, widthPct: 100, start_sec: 0, title: "" }];

  const expanded = controlsVisible || dragging || hovering;
  const barHeight = expanded ? HEIGHT_HOVER : HEIGHT_IDLE;
  const gap = expanded ? 2 : 1;

  const playheadPct =
    Math.min(100, Math.max(0, (currentTime / totalDuration) * 100));
  const bufferedPct =
    Math.min(100, Math.max(0, (bufferedEnd / totalDuration) * 100));

  function fractionFromClientX(clientX: number): number {
    const el = hitRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const f = (clientX - rect.left) / rect.width;
    return Math.max(0, Math.min(1, f));
  }

  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    try {
      hitRef.current?.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    setDragging(true);
    onSeek(fractionFromClientX(e.clientX) * totalDuration);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!dragging) return;
    onSeek(fractionFromClientX(e.clientX) * totalDuration);
  }
  function onPointerUp(e: React.PointerEvent) {
    if (!dragging) return;
    try {
      hitRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    setDragging(false);
  }

  return createPortal(
    <div
      ref={hitRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        height: HIT_HEIGHT,
        cursor: "pointer",
        zIndex: 5,
      }}
    >
      {/* Visible bar — chapter-segment pills with per-segment gradient
          fill. Pointer-events: none so the outer hit container handles
          all click/drag interaction; the bar itself is purely visual. */}
      <div
        ref={setBarRef}
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: barHeight,
          display: "flex",
          gap: `${gap}px`,
          pointerEvents: "none",
          transition: "height 180ms ease, gap 180ms ease",
        }}
      >
        {segments.map((seg, i) => {
          const fillPct = segmentFillPct(seg, totalDuration, currentTime);
          return (
            <div
              key={i}
              style={{
                flex: `${seg.widthPct} 0 0`,
                position: "relative",
                height: "100%",
                background: `linear-gradient(to right, ${accentColor} ${fillPct}%, ${TRACK_BG} ${fillPct}%)`,
                borderRadius: 9999,
                overflow: "hidden",
              }}
            />
          );
        })}
      </div>

      {/* Buffered indicator — drawn as a single overlay across the
          whole bar (independent of chapter segments) so it reads as
          one continuous fill. Sits behind the played fill: the
          played gradient on each segment paints over this. */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          height: barHeight,
          width: `${bufferedPct}%`,
          background: BUFFERED_BG,
          borderRadius: 9999,
          pointerEvents: "none",
          transition: "height 180ms ease, width 200ms ease",
          opacity: bufferedPct > playheadPct ? 1 : 0,
          // Sit below the chapter-segment row.
          zIndex: -1,
        }}
      />

      {/* Scrubber thumb — fades + scales in when expanded. */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          bottom: barHeight / 2 - 6,
          left: `calc(${playheadPct}% - 6px)`,
          width: 12,
          height: 12,
          background: "white",
          borderRadius: "50%",
          boxShadow: expanded
            ? `0 0 0 4px color-mix(in srgb, ${accentColor} 25%, transparent), 0 1px 3px rgba(0,0,0,0.4)`
            : "none",
          opacity: expanded ? 1 : 0,
          transform: expanded ? "scale(1)" : "scale(0)",
          transition:
            "opacity 120ms ease, transform 120ms ease, bottom 180ms ease, box-shadow 120ms ease",
          pointerEvents: "none",
        }}
      />
    </div>,
    playerEl
  );
}
