import type { BubbleShape } from "./types";

/**
 * Returns a Path2D describing the bubble's mask, centered at (cx, cy) with the
 * given diameter. Consumers use the Path2D as a clipping region before drawing
 * the camera stream into the canvas.
 */
export function createBubblePath(
  shape: BubbleShape,
  cx: number,
  cy: number,
  diameter: number
): Path2D {
  const path = new Path2D();
  const r = diameter / 2;

  switch (shape) {
    case "circle":
      path.arc(cx, cy, r, 0, Math.PI * 2);
      break;

    case "rounded-square": {
      const radius = diameter * 0.18;
      const x = cx - r;
      const y = cy - r;
      const size = diameter;
      path.moveTo(x + radius, y);
      path.lineTo(x + size - radius, y);
      path.quadraticCurveTo(x + size, y, x + size, y + radius);
      path.lineTo(x + size, y + size - radius);
      path.quadraticCurveTo(x + size, y + size, x + size - radius, y + size);
      path.lineTo(x + radius, y + size);
      path.quadraticCurveTo(x, y + size, x, y + size - radius);
      path.lineTo(x, y + radius);
      path.quadraticCurveTo(x, y, x + radius, y);
      break;
    }

    case "rectangle": {
      const aspect = 4 / 3;
      const w = diameter * aspect;
      const h = diameter;
      path.rect(cx - w / 2, cy - h / 2, w, h);
      break;
    }

    case "hexagon": {
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i - Math.PI / 6;
        const x = cx + r * Math.cos(angle);
        const y = cy + r * Math.sin(angle);
        if (i === 0) path.moveTo(x, y);
        else path.lineTo(x, y);
      }
      path.closePath();
      break;
    }
  }

  return path;
}

/**
 * Returns the bounding box of the bubble in canvas pixel coordinates,
 * which the compositor uses to decide what region of the camera stream
 * to draw (so the camera video maps correctly to the mask).
 */
export function getBubbleBounds(
  shape: BubbleShape,
  cx: number,
  cy: number,
  diameter: number
): { x: number; y: number; width: number; height: number } {
  if (shape === "rectangle") {
    const aspect = 4 / 3;
    const w = diameter * aspect;
    const h = diameter;
    return { x: cx - w / 2, y: cy - h / 2, width: w, height: h };
  }
  const r = diameter / 2;
  return { x: cx - r, y: cy - r, width: diameter, height: diameter };
}

/**
 * Half-width and half-height of the bubble's bounding box for a given
 * shape and diameter. Used by the position clamp so the bubble's edges
 * never extend past the composite canvas.
 */
export function getBubbleHalfExtents(
  shape: BubbleShape,
  diameter: number
): { halfWidth: number; halfHeight: number } {
  if (shape === "rectangle") {
    const aspect = 4 / 3;
    return { halfWidth: (diameter * aspect) / 2, halfHeight: diameter / 2 };
  }
  const r = diameter / 2;
  return { halfWidth: r, halfHeight: r };
}

/**
 * Clamps a desired bubble center (in canvas pixels) so the bubble's
 * bounding box stays within `[margin, size - margin]` on each axis.
 * Margin defaults to `Math.max(8, diameter * 0.04)` for a small
 * breathing space at the edge.
 */
export function clampBubbleCenter(
  shape: BubbleShape,
  cx: number,
  cy: number,
  diameter: number,
  canvasWidth: number,
  canvasHeight: number,
  margin?: number
): { cx: number; cy: number } {
  const m = margin ?? Math.max(8, diameter * 0.04);
  const { halfWidth, halfHeight } = getBubbleHalfExtents(shape, diameter);
  const minX = halfWidth + m;
  const maxX = canvasWidth - halfWidth - m;
  const minY = halfHeight + m;
  const maxY = canvasHeight - halfHeight - m;
  // If the bubble is too large to fit at all, snap to centre on the
  // overflowing axis rather than producing a NaN clamp range.
  const clampedX = maxX < minX ? canvasWidth / 2 : Math.min(maxX, Math.max(minX, cx));
  const clampedY = maxY < minY ? canvasHeight / 2 : Math.min(maxY, Math.max(minY, cy));
  return { cx: clampedX, cy: clampedY };
}
