"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CommentThread } from "@/lib/review/comments";

const MARKER_SIZE = 18;
const POPUP_WIDTH = 240;

/**
 * Frame.io-style comment markers on the player seekbar. Each marker is
 * a small accent-tinted circle with the commenter's initials, sitting
 * on top of Plyr's progress bar at the comment's timestamp. Hovering
 * shows a small floating card with the commenter's name, when they
 * left the comment, the body (first few lines), and the timestamp.
 * Clicking seeks the player to that timestamp.
 *
 * Portaled to document.body so the popup can extend above the player
 * frame without being clipped by Plyr's overflow:hidden video wrapper.
 * Hidden when Plyr's controls fade out (driven off the same
 * .plyr--hide-controls class the chapter overlay uses) so markers
 * don't float over an idle video. Re-renders on resize / scroll so
 * positions stay locked to the bar.
 */
export function CommentMarkersOverlay({
  progressEl,
  threads,
  totalDuration,
  accentColor,
  onSelect,
}: {
  progressEl: HTMLElement | null;
  /** Numbered threads already filtered for display (resolved ones hidden
   *  by the caller unless the Resolved filter is on). */
  threads: CommentThread[];
  totalDuration: number;
  /** Brand accent — drives the marker fill so comments read as part of
   *  the same visual identity as the seekbar playhead and chapter fill. */
  accentColor: string;
  onSelect: (thread: CommentThread) => void;
}) {
  const [mounted, setMounted] = useState(false);
  const overlayRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Track the seekbar's bounding rect by writing directly to the
  // overlay's style on every animation frame. React state updates
  // would lag a frame behind scroll / lift, which appeared as the
  // markers "drifting" relative to the bar. Reading getBoundingClientRect
  // on rAF lets the browser settle layout for the frame, then we paint
  // the markers on the same frame — true lock-step tracking.
  useEffect(() => {
    if (!progressEl) return;
    let rafId = 0;
    let lastTop = NaN;
    let lastLeft = NaN;
    let lastWidth = NaN;
    const tick = () => {
      const el = overlayRef.current;
      if (el) {
        const r = progressEl.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          const top = r.top + r.height / 2 - MARKER_SIZE / 2;
          if (top !== lastTop || r.left !== lastLeft || r.width !== lastWidth) {
            lastTop = top;
            lastLeft = r.left;
            lastWidth = r.width;
            el.style.top = `${top}px`;
            el.style.left = `${r.left}px`;
            el.style.width = `${r.width}px`;
          }
        }
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [progressEl]);

  if (
    !mounted ||
    !progressEl ||
    totalDuration <= 0 ||
    threads.length === 0
  ) {
    return null;
  }

  const overlay = (
    <div
      ref={overlayRef}
      style={{
        position: "fixed",
        // top/left/width are written by the rAF loop above.
        top: 0,
        left: 0,
        width: 0,
        height: MARKER_SIZE,
        pointerEvents: "none",
        // Above ChapterSegmentsOverlay (z 10) so markers don't get
        // hidden behind the chapter chunks.
        zIndex: 11,
      }}
    >
      {threads.map((c) => {
        const pct = Math.min(
          100,
          Math.max(0, (c.timestampSec / totalDuration) * 100)
        );
        const endPct =
          c.endSec != null
            ? Math.min(100, Math.max(pct, (c.endSec / totalDuration) * 100))
            : null;
        // Decide whether the popup goes left, center, or right of the
        // marker so it doesn't run off the edge of the seekbar. ~120px
        // half-width, then a margin.
        const popupAlignment: "left" | "center" | "right" =
          pct < 18 ? "left" : pct > 82 ? "right" : "center";
        return (
          <div key={c.id}>
            {endPct != null && (
              <div
                aria-hidden="true"
                style={{
                  position: "absolute",
                  left: `${pct}%`,
                  width: `${Math.max(0.4, endPct - pct)}%`,
                  top: MARKER_SIZE / 2 - 2,
                  height: 4,
                  borderRadius: 2,
                  background: accentColor,
                  opacity: c.resolvedAt ? 0.35 : 0.75,
                  pointerEvents: "none",
                }}
              />
            )}
            <Marker
              comment={c}
              leftPct={pct}
              popupAlignment={popupAlignment}
              accentColor={accentColor}
              onSelect={onSelect}
            />
          </div>
        );
      })}
    </div>
  );

  return createPortal(overlay, document.body);
}

function Marker({
  comment,
  leftPct,
  popupAlignment,
  accentColor,
  onSelect,
}: {
  comment: CommentThread;
  leftPct: number;
  popupAlignment: "left" | "center" | "right";
  accentColor: string;
  onSelect: (thread: CommentThread) => void;
}) {
  const [hover, setHover] = useState(false);

  const popupTransform =
    popupAlignment === "left"
      ? "translateX(0)"
      : popupAlignment === "right"
        ? "translateX(-100%)"
        : "translateX(-50%)";
  const popupLeft = popupAlignment === "right" ? "100%" : popupAlignment === "left" ? "0" : "50%";

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onSelect(comment);
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      style={{
        position: "absolute",
        left: `calc(${leftPct}% - ${MARKER_SIZE / 2}px)`,
        top: 0,
        width: MARKER_SIZE,
        height: MARKER_SIZE,
        padding: 0,
        border: "1.5px solid white",
        borderRadius: "50%",
        background: hover ? "white" : accentColor,
        opacity: comment.resolvedAt ? 0.6 : 1,
        color: hover ? accentColor : "white",
        cursor: "pointer",
        pointerEvents: "auto",
        transition: "transform 120ms ease, background 120ms ease, color 120ms ease",
        transform: hover ? "scale(1.15)" : "scale(1)",
        boxShadow: "0 1px 4px rgba(0, 0, 0, 0.5)",
        fontSize: 10,
        fontWeight: 700,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        lineHeight: 1,
      }}
      title={`#${comment.number} ${comment.commenterName} at ${formatTs(comment.timestampSec)}`}
      aria-label={`Comment ${comment.number} by ${comment.commenterName} at ${formatTs(comment.timestampSec)}`}
    >
      {/* Who commented, at a glance (Loom/Frame.io style); the small badge
          is the thread number used in the list and on the frame. */}
      <span aria-hidden="true">{initialOf(comment.commenterName)}</span>
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          top: -7,
          right: -7,
          minWidth: 12,
          height: 12,
          padding: "0 3px",
          borderRadius: 6,
          background: "var(--bg-elevated)",
          color: "var(--text)",
          border: "1px solid var(--border-strong)",
          fontSize: 8,
          fontWeight: 700,
          lineHeight: "10px",
          textAlign: "center",
          pointerEvents: "none",
        }}
      >
        {comment.number}
      </span>
      {hover && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            bottom: "calc(100% + 10px)",
            left: popupLeft,
            transform: popupTransform,
            width: POPUP_WIDTH,
            padding: 12,
            background: "var(--bg-elevated)",
            border: "1px solid var(--border-strong)",
            borderRadius: 10,
            boxShadow: "0 8px 24px rgba(0, 0, 0, 0.4)",
            color: "var(--text)",
            fontSize: 12,
            lineHeight: 1.45,
            textAlign: "left",
            pointerEvents: "none",
            zIndex: 12,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: 8,
              marginBottom: 4,
            }}
          >
            <span style={{ fontWeight: 600 }}>
              {comment.number}. {comment.commenterName}
            </span>
            <span style={{ fontSize: 11, color: "var(--text-subtle)" }}>
              {formatRelative(new Date(comment.createdAt))}
            </span>
          </div>
          <div
            style={{
              color: "var(--text-muted)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              display: "-webkit-box",
              WebkitLineClamp: 4,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {comment.body}
          </div>
          <div
            style={{
              marginTop: 6,
              fontSize: 11,
              color: "var(--text-subtle)",
              fontFamily: "monospace",
            }}
          >
            {formatTs(comment.timestampSec)}
            {comment.endSec != null ? `–${formatTs(comment.endSec)}` : ""}
            {comment.annotation ? " · drawing" : ""}
            {comment.replies.length > 0
              ? ` · ${comment.replies.length} repl${comment.replies.length === 1 ? "y" : "ies"}`
              : ""}
          </div>
        </div>
      )}
    </button>
  );
}

function initialOf(name: string): string {
  const first = name.split(/[\s@.]+/).filter(Boolean)[0];
  return (first?.[0] ?? "?").toUpperCase();
}

function formatTs(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toString().padStart(2, "0")}`;
}

function formatRelative(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}
