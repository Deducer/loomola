"use client";

import {
  useEffect,
  useRef,
  useState,
  useCallback,
  type PointerEvent,
} from "react";
import type { BubbleShape, BubbleSize } from "@/lib/recording/types";
import { BUBBLE_SIZE_FRACTION } from "@/lib/recording/types";
import {
  createBubblePath,
  clampBubbleCenter,
} from "@/lib/recording/bubble-shapes";
import type { BubblePositionController } from "@/lib/recording/composite-canvas";

const PANEL_WIDTH = 320;
const PREVIEW_HEIGHT = 180;

type Props = {
  startedAt: number;
  screenStream: MediaStream;
  cameraEnabled: boolean;
  bubbleShape: BubbleShape;
  bubbleSize: BubbleSize;
  positionController: BubblePositionController;
  onStop: () => void;
};

/**
 * The contents of the docPiP floating window: a live tile of the screen
 * being recorded, a draggable bubble overlay positioned in fractional
 * coordinates that flow straight to the compositor's positionController,
 * a recording timer, and a stop button.
 */
export function FloatingRecordingPanel({
  startedAt,
  screenStream,
  cameraEnabled,
  bubbleShape,
  bubbleSize,
  positionController,
  onStop,
}: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [elapsed, setElapsed] = useState(0);
  const [pos, setPos] = useState(positionController.current);
  const [dragging, setDragging] = useState(false);

  // Wire the screen stream into the preview <video>.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.srcObject = screenStream;
    v.muted = true;
    void v.play().catch(() => {
      /* autoplay can fail if user disabled it; silent */
    });
    return () => {
      v.srcObject = null;
    };
  }, [screenStream]);

  // Tick the timer every 250ms.
  useEffect(() => {
    const id = setInterval(() => {
      setElapsed((performance.now() - startedAt) / 1000);
    }, 250);
    return () => clearInterval(id);
  }, [startedAt]);

  // Draw the bubble outline overlay on the preview video.
  useEffect(() => {
    const canvas = overlayCanvasRef.current;
    if (!canvas || !cameraEnabled) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const diameter = h * BUBBLE_SIZE_FRACTION[bubbleSize];
    const desiredCx = w * pos.x;
    const desiredCy = h * pos.y;
    const { cx, cy } = clampBubbleCenter(
      bubbleShape,
      desiredCx,
      desiredCy,
      diameter,
      w,
      h
    );

    ctx.clearRect(0, 0, w, h);
    const path = createBubblePath(bubbleShape, cx, cy, diameter);

    ctx.save();
    ctx.fillStyle = "rgba(139, 92, 246, 0.35)";
    ctx.fill(path);
    ctx.strokeStyle = dragging
      ? "rgba(255,255,255,0.95)"
      : "rgba(255,255,255,0.7)";
    ctx.lineWidth = dragging ? 3 : 2;
    ctx.stroke(path);
    ctx.restore();
  }, [pos, bubbleShape, bubbleSize, cameraEnabled, dragging]);

  // Drag handler — converts the pointer position inside the preview to
  // a fractional [0, 1] x/y and updates both the local React state (for
  // the overlay) and the positionController (which the compositor reads).
  const updateFromPointer = useCallback(
    (clientX: number, clientY: number) => {
      const el = previewRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const x = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      const y = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
      const next = { x, y };
      positionController.current = next;
      setPos(next);
    },
    [positionController]
  );

  const onPointerDown = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (!cameraEnabled) return;
      e.preventDefault();
      setDragging(true);
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      updateFromPointer(e.clientX, e.clientY);
    },
    [cameraEnabled, updateFromPointer]
  );

  const onPointerMove = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (!dragging) return;
      updateFromPointer(e.clientX, e.clientY);
    },
    [dragging, updateFromPointer]
  );

  const endDrag = useCallback(() => setDragging(false), []);

  return (
    <div
      style={{
        width: PANEL_WIDTH,
        boxSizing: "border-box",
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        fontFamily:
          "var(--font-sans, ui-sans-serif, system-ui, -apple-system, sans-serif)",
        color: "var(--text, #fafafa)",
        background: "var(--bg, #09090b)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span
          aria-hidden="true"
          style={{
            display: "inline-block",
            width: 10,
            height: 10,
            borderRadius: 999,
            background: "var(--destructive, #ef4444)",
            animation: "loomPulse 1.6s ease-in-out infinite",
          }}
        />
        <span
          style={{
            fontFamily: "var(--font-mono, ui-monospace, monospace)",
            fontVariantNumeric: "tabular-nums",
            fontSize: 18,
            fontWeight: 600,
          }}
        >
          {formatElapsed(elapsed)}
        </span>
        <button
          type="button"
          onClick={onStop}
          style={{
            marginLeft: "auto",
            background: "var(--destructive, #ef4444)",
            color: "var(--destructive-fg, #ffffff)",
            border: "none",
            borderRadius: 8,
            padding: "6px 12px",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Stop
        </button>
      </div>

      <div
        ref={previewRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: "16 / 9",
          background: "#000",
          borderRadius: 8,
          overflow: "hidden",
          border: "1px solid var(--border, rgba(255,255,255,0.08))",
          cursor: cameraEnabled ? (dragging ? "grabbing" : "grab") : "default",
          touchAction: "none",
          userSelect: "none",
        }}
      >
        <video
          ref={videoRef}
          playsInline
          muted
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        />
        {cameraEnabled && (
          <canvas
            ref={overlayCanvasRef}
            width={PANEL_WIDTH}
            height={PREVIEW_HEIGHT}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              pointerEvents: "none",
            }}
          />
        )}
      </div>

      {cameraEnabled && (
        <p
          style={{
            margin: 0,
            fontSize: 11,
            color: "var(--text-subtle, #71717a)",
            textAlign: "center",
          }}
        >
          Drag the bubble to reposition it during recording.
        </p>
      )}

      <style>
        {`@keyframes loomPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }`}
      </style>
    </div>
  );
}

function formatElapsed(seconds: number): string {
  const totalSec = Math.max(0, Math.floor(seconds));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
