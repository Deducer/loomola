import type { Resolution } from "./types";
import { RESOLUTION_DIMENSIONS } from "./types";

export class CaptureError extends Error {
  constructor(
    message: string,
    public readonly cause: "permission-denied" | "device-not-found" | "unknown"
  ) {
    super(message);
    this.name = "CaptureError";
  }
}

/**
 * Requests the screen capture stream. Chrome only for system audio.
 */
export async function captureScreen(
  resolution: Resolution,
  systemAudio: boolean
): Promise<MediaStream> {
  const { width, height } = RESOLUTION_DIMENSIONS[resolution];
  try {
    return await navigator.mediaDevices.getDisplayMedia({
      video: {
        width: { ideal: width },
        height: { ideal: height },
        frameRate: { ideal: 30 },
      },
      audio: systemAudio,
    });
  } catch (err) {
    throw mapError(err, "screen capture");
  }
}

/**
 * Requests the camera + mic stream. Camera resolution capped at 1080p
 * regardless of composite resolution — the bubble is displayed small and
 * 1080p is overkill for it.
 */
export async function captureCameraAndMic(): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30 },
      },
      audio: true,
    });
  } catch (err) {
    throw mapError(err, "camera/mic");
  }
}

/**
 * Requests only the microphone (used when camera is disabled but audio
 * is still needed for the composite).
 */
export async function captureMicOnly(): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    throw mapError(err, "microphone");
  }
}

function mapError(err: unknown, source: string): CaptureError {
  if (err && typeof err === "object" && "name" in err) {
    const name = (err as { name: string }).name;
    if (name === "NotAllowedError" || name === "PermissionDeniedError") {
      return new CaptureError(
        `Permission denied for ${source}`,
        "permission-denied"
      );
    }
    if (name === "NotFoundError") {
      return new CaptureError(`No ${source} device found`, "device-not-found");
    }
  }
  return new CaptureError(
    `Failed to capture ${source}: ${String(err)}`,
    "unknown"
  );
}

/**
 * Stops every track in a stream. Safe to call on any MediaStream.
 */
export function stopStream(stream: MediaStream | null): void {
  if (!stream) return;
  for (const track of stream.getTracks()) track.stop();
}

/**
 * Returns a new MediaStream containing only the given track kind.
 * Used to split screen video from screen audio into separate recorders.
 */
export function extractTracks(
  stream: MediaStream,
  kind: "video" | "audio"
): MediaStream | null {
  const tracks = kind === "video" ? stream.getVideoTracks() : stream.getAudioTracks();
  if (tracks.length === 0) return null;
  return new MediaStream(tracks);
}
