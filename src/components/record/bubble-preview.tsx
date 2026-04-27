"use client";

import { useEffect, useRef } from "react";
import type { RecordingSettings } from "@/lib/recording/types";
import { BUBBLE_SIZE_FRACTION } from "@/lib/recording/types";
import { createBubblePath, clampBubbleCenter } from "@/lib/recording/bubble-shapes";

/**
 * Shows a small mock viewport with a dimmed gradient "screen" and the
 * selected bubble rendered in the selected shape / size / position.
 */
export function BubblePreview({ settings }: { settings: RecordingSettings }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;

    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, "#1f2937");
    grad.addColorStop(1, "#0b1220");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    if (!settings.cameraEnabled) return;

    const diameter = h * BUBBLE_SIZE_FRACTION[settings.bubbleSize];
    const desiredCx = w * settings.bubblePosition.x;
    const desiredCy = h * settings.bubblePosition.y;
    // Clamp so the bubble's bounding box stays inside the preview canvas
    // — matches what the compositor does at recording time. Fixes large /
    // rectangle bubbles being half-cropped at the corners.
    const { cx, cy } = clampBubbleCenter(
      settings.bubbleShape,
      desiredCx,
      desiredCy,
      diameter,
      w,
      h
    );
    const path = createBubblePath(settings.bubbleShape, cx, cy, diameter);

    ctx.save();
    ctx.fillStyle = "#4F46E5";
    ctx.fill(path);
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.lineWidth = 2;
    ctx.stroke(path);
    ctx.restore();
  }, [settings]);

  return (
    <canvas
      ref={canvasRef}
      width={480}
      height={270}
      className="w-full rounded-lg border border-border"
    />
  );
}
