import type { RecordingSettings, BubblePosition } from "./types";
import { RESOLUTION_DIMENSIONS, BUBBLE_SIZE_FRACTION } from "./types";
import {
  createBubblePath,
  getBubbleBounds,
  clampBubbleCenter,
} from "./bubble-shapes";

/**
 * A mutable position holder shared between the React UI and the
 * compositor's animation loop. The compositor reads `current` on every
 * frame, so dragging the bubble during recording updates immediately.
 */
export type BubblePositionController = { current: BubblePosition };

type CompositeHandles = {
  canvas: HTMLCanvasElement;
  stream: MediaStream;
  stop: () => void;
  positionController: BubblePositionController;
};

/**
 * Starts a 30fps compositor that draws the screen stream into a hidden
 * canvas, overlaying the camera stream clipped by the configured bubble
 * shape. Returns the canvas element (for debugging / preview wiring) and
 * the canvas's captured MediaStream, which should be added to the
 * composite MediaRecorder.
 */
export function startCompositor(
  screenStream: MediaStream,
  cameraStream: MediaStream | null,
  settings: RecordingSettings
): CompositeHandles {
  const { width, height } = RESOLUTION_DIMENSIONS[settings.resolution];

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context unavailable");

  const screenVideo = document.createElement("video");
  screenVideo.srcObject = screenStream;
  screenVideo.muted = true;
  void screenVideo.play();

  let cameraVideo: HTMLVideoElement | null = null;
  if (cameraStream && settings.cameraEnabled) {
    cameraVideo = document.createElement("video");
    cameraVideo.srcObject = cameraStream;
    cameraVideo.muted = true;
    void cameraVideo.play();
  }

  let frameHandle: number | null = null;
  let stopped = false;

  const diameter = height * BUBBLE_SIZE_FRACTION[settings.bubbleSize];

  // Mutable position holder. Read on every frame so the React UI can
  // drag the bubble during recording and the next frame picks it up.
  const positionController: BubblePositionController = {
    current: { ...settings.bubblePosition },
  };

  function frame() {
    if (stopped) return;

    ctx!.fillStyle = "#000";
    ctx!.fillRect(0, 0, width, height);

    if (screenVideo.readyState >= 2) {
      // Aspect-preserving fit (letterbox). Drawing the source straight
      // into width×height stretches a 16:10 desktop into a 16:9 canvas
      // and produces visibly-squished thumbnails + recordings. Compute
      // a fit-inside rect and centre it; the surrounding black is
      // already painted by the fillRect above.
      const sw = screenVideo.videoWidth || width;
      const sh = screenVideo.videoHeight || height;
      const sourceAspect = sw / sh;
      const targetAspect = width / height;
      let dw: number;
      let dh: number;
      let dx: number;
      let dy: number;
      if (sourceAspect > targetAspect) {
        dw = width;
        dh = width / sourceAspect;
        dx = 0;
        dy = (height - dh) / 2;
      } else {
        dh = height;
        dw = height * sourceAspect;
        dx = (width - dw) / 2;
        dy = 0;
      }
      ctx!.drawImage(screenVideo, dx, dy, dw, dh);
    }

    if (cameraVideo && cameraVideo.readyState >= 2) {
      // Compute bubble path + bounds fresh each frame from the position
      // controller, so dragging mid-recording updates without restart.
      // Clamp so the bubble's bounding box never escapes the canvas.
      const desiredCx = width * positionController.current.x;
      const desiredCy = height * positionController.current.y;
      const { cx, cy } = clampBubbleCenter(
        settings.bubbleShape,
        desiredCx,
        desiredCy,
        diameter,
        width,
        height
      );
      const bubblePath = createBubblePath(settings.bubbleShape, cx, cy, diameter);
      const bubbleBounds = getBubbleBounds(settings.bubbleShape, cx, cy, diameter);

      ctx!.save();
      ctx!.clip(bubblePath);
      const vw = cameraVideo.videoWidth || 1;
      const vh = cameraVideo.videoHeight || 1;
      const scale = Math.max(bubbleBounds.width / vw, bubbleBounds.height / vh);
      const dw = vw * scale;
      const dh = vh * scale;
      const dx = bubbleBounds.x + bubbleBounds.width / 2 - dw / 2;
      const dy = bubbleBounds.y + bubbleBounds.height / 2 - dh / 2;
      ctx!.drawImage(cameraVideo, dx, dy, dw, dh);
      ctx!.restore();

      ctx!.save();
      ctx!.strokeStyle = "rgba(255,255,255,0.25)";
      ctx!.lineWidth = Math.max(2, height / 540);
      ctx!.stroke(bubblePath);
      ctx!.restore();
    }

    frameHandle = requestAnimationFrame(frame);
  }

  frameHandle = requestAnimationFrame(frame);

  const stream = canvas.captureStream(30);

  return {
    canvas,
    stream,
    stop: () => {
      stopped = true;
      if (frameHandle !== null) cancelAnimationFrame(frameHandle);
      screenVideo.srcObject = null;
      if (cameraVideo) cameraVideo.srcObject = null;
    },
    positionController,
  };
}
