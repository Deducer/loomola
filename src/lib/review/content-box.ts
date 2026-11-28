export type Box = { x: number; y: number; width: number; height: number };

/**
 * The rectangle the video picture actually occupies inside an element that
 * draws it with object-fit: contain. Letterbox (top/bottom) or pillarbox
 * (left/right) bars are excluded, so annotation fractions map to the frame
 * itself whatever the player shape. Before metadata loads (no intrinsic
 * size) the whole element is returned.
 */
export function videoContentBox(
  elementWidth: number,
  elementHeight: number,
  videoWidth: number,
  videoHeight: number
): Box {
  if (elementWidth <= 0 || elementHeight <= 0 || videoWidth <= 0 || videoHeight <= 0) {
    return { x: 0, y: 0, width: Math.max(0, elementWidth), height: Math.max(0, elementHeight) };
  }
  const elementRatio = elementWidth / elementHeight;
  const videoRatio = videoWidth / videoHeight;
  if (videoRatio > elementRatio) {
    const height = elementWidth / videoRatio;
    return { x: 0, y: (elementHeight - height) / 2, width: elementWidth, height };
  }
  const width = elementHeight * videoRatio;
  return { x: (elementWidth - width) / 2, y: 0, width, height: elementHeight };
}

/** Pointer position (relative to the element) → frame fractions, clamped. */
export function toFrameFraction(px: number, py: number, box: Box): [number, number] {
  const fx = box.width > 0 ? (px - box.x) / box.width : 0;
  const fy = box.height > 0 ? (py - box.y) / box.height : 0;
  return [Math.min(1, Math.max(0, fx)), Math.min(1, Math.max(0, fy))];
}
