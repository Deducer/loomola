"use client";

import { useEffect, useRef } from "react";
import type { BubbleShape, BubbleSize } from "@/lib/recording/types";
import type { BubblePositionController } from "@/lib/recording/composite-canvas";
import { isDocPiPAvailable } from "./pip-window";

const PIP_PX_FOR_SIZE: Record<BubbleSize, number> = {
  small: 160,
  medium: 220,
  large: 280,
};

const RECT_ASPECT = 4 / 3;

type Props = {
  cameraStream: MediaStream;
  bubbleShape: BubbleShape;
  bubbleSize: BubbleSize;
  positionController: BubblePositionController;
  onStop: () => void;
};

/**
 * Loom-style camera bubble as a Document Picture-in-Picture window. The
 * window contains only the live camera (clipped to the bubble shape) plus
 * a hover-revealed stop button — the user drags the window itself, exactly
 * like Loom's macOS overlay. The window's screen position is polled each
 * frame and translated into the fractional bubble position the compositor
 * uses, so dragging updates the bubble in the recording immediately.
 *
 * Browsers without `documentPictureInPicture` get nothing here; the in-tab
 * RecordingHud remains the fallback for stop / status.
 */
export function BubblePipWindow({
  cameraStream,
  bubbleShape,
  bubbleSize,
  positionController,
  onStop,
}: Props) {
  const stopRef = useRef(onStop);
  stopRef.current = onStop;

  useEffect(() => {
    if (!isDocPiPAvailable()) return;

    let cancelled = false;
    let pip: Window | null = null;
    let rafHandle: number | null = null;

    (async () => {
      try {
        const baseSize = PIP_PX_FOR_SIZE[bubbleSize];
        const width = bubbleShape === "rectangle" ? Math.round(baseSize * RECT_ASPECT) : baseSize;
        const height = baseSize;
        pip = await window.documentPictureInPicture!.requestWindow({
          width,
          height,
        });
        if (cancelled) {
          pip.close();
          return;
        }

        // Inherit theme tokens for the stop button styling.
        for (const node of Array.from(
          document.querySelectorAll("link[rel='stylesheet'], style")
        )) {
          pip.document.head.appendChild(node.cloneNode(true));
        }
        pip.document.documentElement.className = document.documentElement.className;
        pip.document.body.className = document.body.className;

        // Clean body chrome — fill window with the camera, no padding.
        const body = pip.document.body;
        body.style.margin = "0";
        body.style.padding = "0";
        body.style.background = "#000";
        body.style.overflow = "hidden";
        body.style.cursor = "move";
        body.style.position = "relative";
        body.style.width = "100vw";
        body.style.height = "100vh";

        const video = pip.document.createElement("video");
        video.autoplay = true;
        video.muted = true;
        video.playsInline = true;
        video.srcObject = cameraStream;
        Object.assign(video.style, {
          position: "absolute",
          inset: "0",
          width: "100%",
          height: "100%",
          objectFit: "cover",
          background: "#000",
          ...shapeClip(bubbleShape),
        } as CSSStyleDeclaration);
        body.appendChild(video);
        video.play().catch(() => {
          /* autoplay restrictions can swallow this — silent */
        });

        // Hover-revealed stop button. Positioned at the bottom of the
        // pip; visible whenever the cursor is over the window.
        const stopBtn = pip.document.createElement("button");
        stopBtn.type = "button";
        stopBtn.textContent = "Stop";
        Object.assign(stopBtn.style, {
          position: "absolute",
          left: "50%",
          bottom: "12px",
          transform: "translateX(-50%)",
          padding: "6px 14px",
          borderRadius: "999px",
          border: "none",
          background: "var(--destructive, #ef4444)",
          color: "var(--destructive-fg, #ffffff)",
          fontSize: "12px",
          fontWeight: "600",
          fontFamily:
            "var(--font-sans, ui-sans-serif, system-ui, -apple-system, sans-serif)",
          cursor: "pointer",
          opacity: "0",
          transition: "opacity 0.15s ease",
          pointerEvents: "none",
          boxShadow: "0 2px 12px rgba(0,0,0,0.4)",
        } as CSSStyleDeclaration);
        body.appendChild(stopBtn);

        body.addEventListener("mouseenter", () => {
          stopBtn.style.opacity = "1";
          stopBtn.style.pointerEvents = "auto";
        });
        body.addEventListener("mouseleave", () => {
          stopBtn.style.opacity = "0";
          stopBtn.style.pointerEvents = "none";
        });
        stopBtn.addEventListener("click", () => stopRef.current());

        // Poll the pip's screen position each frame and translate into
        // a fractional position on the user's screen. The compositor
        // reads `positionController.current` on every frame, so this
        // becomes "drag the bubble live during recording."
        const tick = () => {
          if (cancelled || !pip) return;
          const cx = pip.screenX + pip.outerWidth / 2;
          const cy = pip.screenY + pip.outerHeight / 2;
          const sw = pip.screen?.width || window.screen.width || 1920;
          const sh = pip.screen?.height || window.screen.height || 1080;
          positionController.current = {
            x: Math.min(1, Math.max(0, cx / sw)),
            y: Math.min(1, Math.max(0, cy / sh)),
          };
          rafHandle = requestAnimationFrame(tick);
        };
        rafHandle = requestAnimationFrame(tick);
      } catch (err) {
        console.warn("[bubble-pip] requestWindow failed:", err);
      }
    })();

    return () => {
      cancelled = true;
      if (rafHandle !== null) cancelAnimationFrame(rafHandle);
      if (pip) {
        try {
          pip.close();
        } catch {
          /* already closed */
        }
      }
    };
  }, [cameraStream, bubbleShape, bubbleSize, positionController]);

  return null;
}

function shapeClip(shape: BubbleShape): Partial<CSSStyleDeclaration> {
  switch (shape) {
    case "circle":
      return { borderRadius: "50%" };
    case "rounded-square":
      return { borderRadius: "18%" };
    case "rectangle":
      return { borderRadius: "8%" };
    case "hexagon":
      // CSS clip-path for a regular hexagon (flat-top inscribed in the box).
      return {
        clipPath:
          "polygon(25% 6.7%, 75% 6.7%, 100% 50%, 75% 93.3%, 25% 93.3%, 0% 50%)",
      };
  }
}
