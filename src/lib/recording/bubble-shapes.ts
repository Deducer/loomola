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
