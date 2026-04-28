"use client";

import { useEffect, useRef, useState } from "react";
import type { BubbleShape, BubbleSize } from "@/lib/recording/types";

const STANDALONE_PX_FOR_SIZE: Record<BubbleSize, number> = {
  small: 160,
  medium: 220,
  large: 280,
};

/**
 * Frameless bubble rendered inside an iframe by the Chrome extension.
 * Shows the live camera and is draggable; drag deltas post to the parent
 * (the captured tab) which forwards them to the recording app via the
 * extension's message bridge.
 *
 * When viewed standalone (not in an iframe — e.g. opening /bubble directly
 * for a quick check), the page constrains itself to a sensible bubble-sized
 * preview centered on a neutral backdrop, instead of stretching the circle
 * across the entire viewport into a giant ellipse.
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
  const [standalone, setStandalone] = useState(false);
  const dragRef = useRef<{ active: boolean; offsetX: number; offsetY: number }>({
    active: false,
    offsetX: 0,
    offsetY: 0,
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    setStandalone(window.parent === window);
  }, []);

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
  //
  // Use `screenX/screenY` (absolute desktop coords) instead of
  // `clientX/clientY` (iframe-relative). When the parent moves the iframe
  // mid-drag, the cursor's iframe-relative position shifts even though the
  // physical cursor didn't move — Chrome can synthesise pointermoves that
  // look like reverse motion → the bubble jitters back and forth. screenX/Y
  // is invariant to iframe transforms, so deltas are pure user motion.
  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      dragRef.current.active = true;
      dragRef.current.offsetX = e.screenX;
      dragRef.current.offsetY = e.screenY;
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    }
    function onPointerMove(e: PointerEvent) {
      if (!dragRef.current.active) return;
      const dx = e.screenX - dragRef.current.offsetX;
      const dy = e.screenY - dragRef.current.offsetY;
      if (dx === 0 && dy === 0) return;
      window.parent.postMessage(
        { source: "loom-clone-bubble", type: "delta", dx, dy },
        "*"
      );
      dragRef.current.offsetX = e.screenX;
      dragRef.current.offsetY = e.screenY;
    }
    function onPointerUp() {
      if (!dragRef.current.active) return;
      dragRef.current.active = false;
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

  const sizePx = STANDALONE_PX_FOR_SIZE[size];
  const containerStyle: React.CSSProperties = standalone
    ? {
        position: "fixed",
        inset: 0,
        margin: 0,
        padding: 0,
        background: "#0b0b0c",
        overflow: "hidden",
        userSelect: "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }
    : {
        width: "100vw",
        height: "100vh",
        margin: 0,
        padding: 0,
        background: "transparent",
        overflow: "hidden",
        cursor: "move",
        userSelect: "none",
        touchAction: "none",
      };
  const innerStyle: React.CSSProperties = standalone
    ? {
        width: sizePx,
        height: sizePx,
        position: "relative",
        cursor: "move",
        touchAction: "none",
      }
    : {
        width: "100%",
        height: "100%",
        position: "relative",
      };

  return (
    <div style={containerStyle}>
      {standalone && (
        <p
          style={{
            position: "fixed",
            top: 16,
            left: 16,
            right: 16,
            margin: 0,
            color: "#a1a1aa",
            fontFamily:
              "-apple-system, BlinkMacSystemFont, system-ui, sans-serif",
            fontSize: 12,
            textAlign: "center",
          }}
        >
          Standalone preview — this page is meant to be embedded as a small
          iframe by the Chrome extension during recording. Resize the URL bar
          query (e.g.{" "}
          <code style={{ color: "#a78bfa" }}>?shape=rounded-square&amp;size=large</code>)
          to preview different shapes / sizes.
        </p>
      )}
      <div style={innerStyle}>
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
