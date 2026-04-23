import type { RecordingSettings } from "./types";
import { RESOLUTION_DIMENSIONS, BUBBLE_SIZE_FRACTION } from "./types";
import { createBubblePath, getBubbleBounds } from "./bubble-shapes";

type CompositeHandles = {
  canvas: HTMLCanvasElement;
  stream: MediaStream;
  stop: () => void;
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
  const cx = width * settings.bubblePosition.x;
  const cy = height * settings.bubblePosition.y;
  const bubblePath = createBubblePath(settings.bubbleShape, cx, cy, diameter);
  const bubbleBounds = getBubbleBounds(settings.bubbleShape, cx, cy, diameter);

  function frame() {
    if (stopped) return;

    ctx!.fillStyle = "#000";
    ctx!.fillRect(0, 0, width, height);

    if (screenVideo.readyState >= 2) {
      ctx!.drawImage(screenVideo, 0, 0, width, height);
    }

    if (cameraVideo && cameraVideo.readyState >= 2) {
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
  };
}
