export type Resolution = "1080p" | "1440p" | "4k";

export type BubbleShape = "circle" | "rounded-square" | "rectangle" | "hexagon";

export type BubbleSize = "small" | "medium" | "large";

export type BubblePosition = {
  /** Fractional x offset within the viewport, 0 = left, 1 = right */
  x: number;
  /** Fractional y offset within the viewport, 0 = top, 1 = bottom */
  y: number;
};

export type RecordingSettings = {
  resolution: Resolution;
  cameraEnabled: boolean;
  bubbleShape: BubbleShape;
  bubbleSize: BubbleSize;
  bubblePosition: BubblePosition;
  systemAudioEnabled: boolean;
  brandProfileId: string | null;
  /** MediaDeviceInfo.deviceId for the selected mic. null = OS default. */
  micDeviceId: string | null;
  /** MediaDeviceInfo.deviceId for the selected camera. null = OS default. */
  cameraDeviceId: string | null;
};

export type RecorderState =
  | { kind: "idle" }
  | { kind: "countdown"; secondsLeft: number }
  | { kind: "recording"; startedAt: number }
  | { kind: "finished"; result: RecordingResult }
  | { kind: "error"; message: string };

export type TrackKind =
  | "composite"
  | "screen"
  | "camera"
  | "mic"
  | "system-audio";

export type RecordedTrack = {
  kind: TrackKind;
  blob: Blob;
  mimeType: string;
  sizeBytes: number;
};

export type RecordingResult = {
  durationSeconds: number;
  settings: RecordingSettings;
  tracks: RecordedTrack[];
};

export const DEFAULT_SETTINGS: RecordingSettings = {
  resolution: "1080p",
  cameraEnabled: true,
  bubbleShape: "circle",
  bubbleSize: "medium",
  bubblePosition: { x: 0.92, y: 0.88 },
  systemAudioEnabled: false,
  brandProfileId: null,
  micDeviceId: null,
  cameraDeviceId: null,
};

/** Pixel dimensions for each resolution preset. */
export const RESOLUTION_DIMENSIONS: Record<Resolution, { width: number; height: number }> = {
  "1080p": { width: 1920, height: 1080 },
  "1440p": { width: 2560, height: 1440 },
  "4k": { width: 3840, height: 2160 },
};

/** Diameter of the bubble as a fraction of the composite height. */
export const BUBBLE_SIZE_FRACTION: Record<BubbleSize, number> = {
  small: 0.15,
  medium: 0.22,
  large: 0.3,
};
