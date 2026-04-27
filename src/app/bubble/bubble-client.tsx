"use client";

import { useEffect, useRef, useState } from "react";
import type { BubbleShape, BubbleSize } from "@/lib/recording/types";

/**
 * Frameless bubble rendered inside an iframe by the Chrome extension.
 * Shows the live camera and is draggable; drag deltas post to the parent
 * (the captured tab) which forwards them to the recording app via the
 * extension's message bridge.
 */
export function BubbleClient({
  shape,
  size,
}: {
  shape: BubbleShape;
  size: BubbleSize;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dragRef = useRef<{ active: boolean; offsetX: number; offsetY: number }>({
    active: false,
    offsetX: 0,
    offsetY: 0,
  });

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;
    (async () => {
      try {
        // Camera permission is granted to loom.dissonance.cloud already
        // (the user enabled it for /record). The iframe inherits that.
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const v = videoRef.current;
        if (v) {
          v.srcObject = stream;
          v.muted = true;
          await v.play().catch(() => {});
        }
      } catch (err) {
        setError(String(err));
      }
    })();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // Drag: tell the parent to move the iframe.
  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      dragRef.current.active = true;
      // The iframe's clientX/Y is relative to the iframe — convert to page
      // coords by adding the iframe's own offset (we don't know it from
      // inside, so we let the parent handle the absolute position; we just
      // track delta-on-drag and post that).
      dragRef.current.offsetX = e.clientX;
      dragRef.current.offsetY = e.clientY;
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    }
    function onPointerMove(e: PointerEvent) {
      if (!dragRef.current.active) return;
      const dx = e.clientX - dragRef.current.offsetX;
      const dy = e.clientY - dragRef.current.offsetY;
      // Tell the parent (captured tab) to move the iframe by (dx, dy).
      // The parent recomputes the iframe's page-position and forwards a
      // fractional position back to the recording tab.
      window.parent.postMessage(
        { source: "loom-clone-bubble", type: "delta", dx, dy },
        "*"
      );
      // Also re-anchor our drag origin so subsequent moves are deltas-from-now.
      dragRef.current.offsetX = e.clientX;
      dragRef.current.offsetY = e.clientY;
    }
    function onPointerUp() {
      if (!dragRef.current.active) return;
      dragRef.current.active = false;
      // Final position notification — the parent already moved the iframe;
      // it should now publish the resulting fractional position.
      window.parent.postMessage(
        { source: "loom-clone-bubble", type: "drag" },
        "*"
      );
    }
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, []);

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        margin: 0,
        padding: 0,
        background: "transparent",
        overflow: "hidden",
        cursor: "move",
        userSelect: "none",
        touchAction: "none",
      }}
    >
      {error ? (
        <div
          style={{
            width: "100%",
            height: "100%",
            background: "#0b0b0c",
            color: "#a1a1aa",
            fontFamily:
              "-apple-system, BlinkMacSystemFont, system-ui, sans-serif",
            fontSize: 11,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            padding: 8,
            borderRadius: shapeBorderRadius(shape),
          }}
        >
          camera unavailable
        </div>
      ) : (
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            background: "#000",
            ...shapeClipStyle(shape),
            boxShadow: "0 6px 24px rgba(0, 0, 0, 0.45)",
            border: "2px solid rgba(255, 255, 255, 0.65)",
            boxSizing: "border-box",
          }}
        />
      )}
    </div>
  );
}

function shapeBorderRadius(shape: BubbleShape): string {
  switch (shape) {
    case "circle":
      return "50%";
    case "rounded-square":
      return "18%";
    case "rectangle":
      return "8%";
    case "hexagon":
      return "0";
  }
}

function shapeClipStyle(shape: BubbleShape): React.CSSProperties {
  if (shape === "hexagon") {
    return {
      clipPath:
        "polygon(25% 6.7%, 75% 6.7%, 100% 50%, 75% 93.3%, 25% 93.3%, 0% 50%)",
    };
  }
  return { borderRadius: shapeBorderRadius(shape) };
}
