# Loom Clone — Milestone 3: Recording Capture — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a browser-based recording flow — screen + camera bubble + mic + optional system audio, composited client-side into a single video with parallel raw-track backups — that produces downloadable blobs locally. No upload, no server persistence; M4 adds those.

**Architecture:** A single `/record` page driven by a client-side state machine (idle → countdown → recording → finished) that orchestrates `getDisplayMedia` + `getUserMedia`, a `<canvas>`-based compositor drawing the screen feed with a shaped camera bubble at 30 fps, a Web Audio mixer merging mic + system audio, and five parallel `MediaRecorder` instances (one composite + four raw tracks). On stop, blobs are handed to a finished view that exposes them as downloads.

**Tech Stack:** Browser APIs (`getDisplayMedia`, `getUserMedia`, `MediaRecorder`, Web Audio API, Canvas 2D, `requestAnimationFrame`), React 19 client components with `useReducer` for the state machine, Vitest for pure-module tests, Playwright with `--use-fake-device-for-media-stream` for E2E.

---

## File Structure (Milestone 3)

**New files:**

```
src/
├── lib/
│   └── recording/
│       ├── types.ts                      # RecordingSettings, RecorderState, RecordingResult
│       ├── bubble-shapes.ts              # Path2D factories for 4 bubble shapes
│       ├── capture-streams.ts            # getDisplayMedia + getUserMedia wrappers
│       ├── audio-mixer.ts                # Web Audio mic + system-audio mixing
│       ├── composite-canvas.ts           # draw loop: screen + bubble at 30fps
│       └── recorder.ts                   # orchestrates 5 parallel MediaRecorders
├── app/
│   └── record/
│       └── page.tsx                      # server: fetch brands, pass to client form
├── components/
│   └── record/
│       ├── record-flow.tsx               # client: state machine + top-level switcher
│       ├── pre-record-form.tsx           # idle state: settings UI
│       ├── bubble-preview.tsx            # live preview of bubble shape/size/position
│       ├── countdown.tsx                 # 3-2-1 animation
│       ├── recording-hud.tsx             # timer + stop/pause during recording
│       └── finished-view.tsx             # download links for composite + raw tracks
└── components/
    └── nav/
        └── top-nav.tsx                   # MODIFY: add "Record" link (active path key)

tests/
├── unit/
│   ├── bubble-shapes.test.ts             # Path2D factory tests (pure)
│   └── recording-types.test.ts           # default settings + state transition helpers
└── e2e/
    └── record.spec.ts                    # record 3s with fake streams, download blob
```

**File responsibility boundaries:**

- `src/lib/recording/types.ts` — all recording-related TypeScript types in one place. Consumed by every other recording module and every record component.
- `src/lib/recording/bubble-shapes.ts` — **pure, testable.** Given a shape name + size + position, returns a `Path2D` that the compositor uses as a clipping mask. No DOM, no canvas.
- `src/lib/recording/capture-streams.ts` — thin wrappers around `getDisplayMedia` + `getUserMedia` with our exact constraints. Throws typed errors on permission denial.
- `src/lib/recording/audio-mixer.ts` — uses `AudioContext` + `MediaStreamAudioSourceNode` + `MediaStreamAudioDestinationNode` to merge 1-2 input audio tracks into a single output track.
- `src/lib/recording/composite-canvas.ts` — `requestAnimationFrame` loop that draws the screen `<video>` to a hidden `<canvas>`, then applies the bubble `<video>` clipped by a `Path2D` from `bubble-shapes`. Returns `canvas.captureStream(30)`.
- `src/lib/recording/recorder.ts` — creates 4-5 `MediaRecorder` instances, starts/stops them together, collects blobs per recorder. Single entry point: `startRecording(settings) → RecorderHandle` and `handle.stop() → RecordingResult`.
- `src/components/record/record-flow.tsx` — the only stateful component. Owns the `useReducer` state machine and switches between four sub-views.
- Each sub-view component is dumb: receives props, calls callbacks.

---

## Tasks

### Task 1: Recording types module

**Files:**
- Create: `src/lib/recording/types.ts`

- [ ] **Step 1: Write the types**

```typescript
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
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run typecheck
```
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/lib/recording/types.ts
git commit -m "feat(recording): add types module"
```

---

### Task 2: Bubble shapes module

**Files:**
- Create: `src/lib/recording/bubble-shapes.ts`

- [ ] **Step 1: Create the module**

```typescript
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
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run typecheck
```
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/lib/recording/bubble-shapes.ts
git commit -m "feat(recording): add bubble shape Path2D factory"
```

---

### Task 3: Unit tests for bubble shapes

**Files:**
- Create: `tests/unit/bubble-shapes.test.ts`

- [ ] **Step 1: Install jsdom for Path2D availability**

```bash
npm install --save-dev jsdom @vitest/browser
```

Actually — Path2D works in `happy-dom` which is lighter and already-Vitest-compatible. Use that instead:

```bash
npm install --save-dev happy-dom
```

- [ ] **Step 2: Configure Vitest for happy-dom on DOM-touching tests**

Modify `vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    environmentMatchGlobs: [
      ["tests/unit/bubble-shapes.test.ts", "happy-dom"],
    ],
  },
  resolve: {
    alias: { "@": new URL("./src", import.meta.url).pathname },
  },
});
```

- [ ] **Step 3: Write the tests**

Create `tests/unit/bubble-shapes.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { createBubblePath, getBubbleBounds } from "@/lib/recording/bubble-shapes";

describe("createBubblePath", () => {
  it("returns a Path2D for circle", () => {
    const path = createBubblePath("circle", 100, 100, 50);
    expect(path).toBeInstanceOf(Path2D);
  });

  it("returns a Path2D for rounded-square", () => {
    const path = createBubblePath("rounded-square", 100, 100, 50);
    expect(path).toBeInstanceOf(Path2D);
  });

  it("returns a Path2D for rectangle", () => {
    const path = createBubblePath("rectangle", 100, 100, 50);
    expect(path).toBeInstanceOf(Path2D);
  });

  it("returns a Path2D for hexagon", () => {
    const path = createBubblePath("hexagon", 100, 100, 50);
    expect(path).toBeInstanceOf(Path2D);
  });
});

describe("getBubbleBounds", () => {
  it("centers the circle on the given point", () => {
    const b = getBubbleBounds("circle", 200, 150, 100);
    expect(b).toEqual({ x: 150, y: 100, width: 100, height: 100 });
  });

  it("widens rectangles to 4:3 aspect", () => {
    const b = getBubbleBounds("rectangle", 0, 0, 90);
    expect(b.width).toBe(120);
    expect(b.height).toBe(90);
  });

  it("returns a square for rounded-square shape", () => {
    const b = getBubbleBounds("rounded-square", 0, 0, 80);
    expect(b.width).toBe(b.height);
  });
});
```

- [ ] **Step 4: Run tests**

```bash
npm run test
```
Expected: 8 (existing) + 7 (new) = 15 tests passing.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/bubble-shapes.test.ts vitest.config.ts package.json package-lock.json
git commit -m "test(recording): bubble shape Path2D + bounds"
```

---

### Task 4: Capture streams module

**Files:**
- Create: `src/lib/recording/capture-streams.ts`

- [ ] **Step 1: Create the module**

```typescript
import type { Resolution, RecordingSettings } from "./types";
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
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run typecheck
```
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/lib/recording/capture-streams.ts
git commit -m "feat(recording): add stream capture wrappers"
```

---

### Task 5: Audio mixer module

**Files:**
- Create: `src/lib/recording/audio-mixer.ts`

- [ ] **Step 1: Create the module**

```typescript
/**
 * Mixes one or two MediaStreams into a single audio-only MediaStream via
 * Web Audio's MediaStreamAudioSourceNode + MediaStreamAudioDestinationNode.
 * Returns the mixed stream plus a disposer to tear down the AudioContext.
 */
export function createAudioMixer(inputs: (MediaStream | null)[]): {
  output: MediaStream;
  dispose: () => void;
} {
  const ctx = new AudioContext();
  const dest = ctx.createMediaStreamDestination();

  const sources: MediaStreamAudioSourceNode[] = [];
  for (const input of inputs) {
    if (!input) continue;
    if (input.getAudioTracks().length === 0) continue;
    const source = ctx.createMediaStreamSource(input);
    source.connect(dest);
    sources.push(source);
  }

  return {
    output: dest.stream,
    dispose: () => {
      for (const s of sources) s.disconnect();
      void ctx.close();
    },
  };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run typecheck
```
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/lib/recording/audio-mixer.ts
git commit -m "feat(recording): add Web Audio mixer for mic + system audio"
```

---

### Task 6: Composite canvas module

**Files:**
- Create: `src/lib/recording/composite-canvas.ts`

- [ ] **Step 1: Create the module**

```typescript
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

    // Background (black, shown before screen video has data)
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, width, height);

    // Screen
    if (screenVideo.readyState >= 2) {
      ctx.drawImage(screenVideo, 0, 0, width, height);
    }

    // Bubble
    if (cameraVideo && cameraVideo.readyState >= 2) {
      ctx.save();
      ctx.clip(bubblePath);
      // Scale camera video to fill the bubble bounds, preserving aspect
      const vw = cameraVideo.videoWidth || 1;
      const vh = cameraVideo.videoHeight || 1;
      const scale = Math.max(bubbleBounds.width / vw, bubbleBounds.height / vh);
      const dw = vw * scale;
      const dh = vh * scale;
      const dx = bubbleBounds.x + bubbleBounds.width / 2 - dw / 2;
      const dy = bubbleBounds.y + bubbleBounds.height / 2 - dh / 2;
      ctx.drawImage(cameraVideo, dx, dy, dw, dh);
      ctx.restore();

      // Subtle border around bubble for visual separation
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.lineWidth = Math.max(2, height / 540);
      ctx.stroke(bubblePath);
      ctx.restore();
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
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run typecheck
```
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/lib/recording/composite-canvas.ts
git commit -m "feat(recording): add canvas compositor for screen + bubble"
```

---

### Task 7: Recorder orchestration module

**Files:**
- Create: `src/lib/recording/recorder.ts`

- [ ] **Step 1: Create the module**

```typescript
import type {
  RecordingSettings,
  RecordingResult,
  RecordedTrack,
  TrackKind,
} from "./types";
import {
  captureScreen,
  captureCameraAndMic,
  captureMicOnly,
  stopStream,
  extractTracks,
  CaptureError,
} from "./capture-streams";
import { createAudioMixer } from "./audio-mixer";
import { startCompositor } from "./composite-canvas";

const VP9_MIME = "video/webm;codecs=vp9,opus";
const OPUS_MIME = "audio/webm;codecs=opus";

export type RecorderHandle = {
  stop: () => Promise<RecordingResult>;
  /** Resolves if the user cancels/permission fails mid-setup. */
  settled: Promise<void>;
};

type RecorderSlot = {
  kind: TrackKind;
  recorder: MediaRecorder;
  chunks: Blob[];
  mimeType: string;
};

export async function startRecording(
  settings: RecordingSettings
): Promise<RecorderHandle> {
  // 1) Acquire streams (may throw CaptureError on permission denial).
  const screenStream = await captureScreen(
    settings.resolution,
    settings.systemAudioEnabled
  );
  let camStream: MediaStream | null = null;
  if (settings.cameraEnabled) {
    camStream = await captureCameraAndMic();
  } else {
    // Still grab the mic even if no camera (so we have voice).
    camStream = await captureMicOnly();
  }

  // 2) Split tracks so raw recorders record each source separately.
  const screenVideoOnly = extractTracks(screenStream, "video");
  const screenAudioOnly = extractTracks(screenStream, "audio"); // may be null
  const cameraVideoOnly = settings.cameraEnabled
    ? extractTracks(camStream, "video")
    : null;
  const micOnly = extractTracks(camStream, "audio");

  // 3) Start the compositor using the screen video + camera stream.
  const compositor = startCompositor(screenStream, camStream, settings);

  // 4) Mix mic + system audio into the composite stream's audio track.
  const mixer = createAudioMixer([micOnly, screenAudioOnly]);
  const compositeStream = new MediaStream([
    ...compositor.stream.getVideoTracks(),
    ...mixer.output.getAudioTracks(),
  ]);

  // 5) Build recorders.
  const slots: RecorderSlot[] = [];

  slots.push(makeSlot("composite", compositeStream, VP9_MIME));
  if (screenVideoOnly) slots.push(makeSlot("screen", screenVideoOnly, VP9_MIME));
  if (cameraVideoOnly) slots.push(makeSlot("camera", cameraVideoOnly, VP9_MIME));
  if (micOnly) slots.push(makeSlot("mic", micOnly, OPUS_MIME));
  if (screenAudioOnly)
    slots.push(makeSlot("system-audio", screenAudioOnly, OPUS_MIME));

  // 6) Start all recorders at the same time. We ignore the microsecond-level
  //    drift between them; it's under the frame time and invisible for our use.
  for (const s of slots) s.recorder.start(/* timeslice */);

  const startTime = performance.now();
  let settledResolve: () => void = () => {};
  const settled = new Promise<void>((res) => (settledResolve = res));

  const stop = (): Promise<RecordingResult> =>
    new Promise<RecordingResult>((resolve) => {
      const durationSeconds = (performance.now() - startTime) / 1000;

      // MediaRecorder.stop is async; collect the final chunks from each.
      const stops = slots.map(
        (slot) =>
          new Promise<RecordedTrack>((resolveSlot) => {
            slot.recorder.addEventListener(
              "stop",
              () => {
                const blob = new Blob(slot.chunks, { type: slot.mimeType });
                resolveSlot({
                  kind: slot.kind,
                  blob,
                  mimeType: slot.mimeType,
                  sizeBytes: blob.size,
                });
              },
              { once: true }
            );
            slot.recorder.stop();
          })
      );

      Promise.all(stops).then((tracks) => {
        // Tear down streams + audio + compositor.
        compositor.stop();
        mixer.dispose();
        stopStream(screenStream);
        stopStream(camStream);
        settledResolve();
        resolve({ durationSeconds, settings, tracks });
      });
    });

  // If the user revokes screen-share via the browser bar, the screen track
  // fires "ended". Treat that as a user-initiated stop.
  const primaryScreenTrack = screenStream.getVideoTracks()[0];
  if (primaryScreenTrack) {
    primaryScreenTrack.addEventListener(
      "ended",
      () => {
        // Caller's state machine listens to the "ended" by checking settled;
        // but we also need to actually stop the recorders so blobs flush.
        void stop();
      },
      { once: true }
    );
  }

  return { stop, settled };
}

function makeSlot(
  kind: TrackKind,
  stream: MediaStream,
  preferredMime: string
): RecorderSlot {
  const mimeType = MediaRecorder.isTypeSupported(preferredMime)
    ? preferredMime
    : "";
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: Blob[] = [];
  recorder.addEventListener("dataavailable", (evt) => {
    if (evt.data && evt.data.size > 0) chunks.push(evt.data);
  });
  return { kind, recorder, chunks, mimeType: mimeType || "video/webm" };
}

export { CaptureError };
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run typecheck
```
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/lib/recording/recorder.ts
git commit -m "feat(recording): add parallel MediaRecorder orchestration"
```

---

### Task 8: Bubble preview component

**Files:**
- Create: `src/components/record/bubble-preview.tsx`

- [ ] **Step 1: Create the component**

```typescript
"use client";

import { useEffect, useRef } from "react";
import type { RecordingSettings } from "@/lib/recording/types";
import { BUBBLE_SIZE_FRACTION } from "@/lib/recording/types";
import { createBubblePath } from "@/lib/recording/bubble-shapes";

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

    // Mock screen background
    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, "#1f2937");
    grad.addColorStop(1, "#0b1220");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    if (!settings.cameraEnabled) return;

    const diameter = h * BUBBLE_SIZE_FRACTION[settings.bubbleSize];
    const cx = w * settings.bubblePosition.x;
    const cy = h * settings.bubblePosition.y;
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
      className="w-full rounded border border-white/10"
    />
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run typecheck
```
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/components/record/bubble-preview.tsx
git commit -m "feat(record): add bubble preview component"
```

---

### Task 9: Pre-record form component

**Files:**
- Create: `src/components/record/pre-record-form.tsx`

- [ ] **Step 1: Create the component**

```typescript
"use client";

import { useState } from "react";
import type {
  RecordingSettings,
  Resolution,
  BubbleShape,
  BubbleSize,
} from "@/lib/recording/types";
import { DEFAULT_SETTINGS } from "@/lib/recording/types";
import { BubblePreview } from "./bubble-preview";
import type { BrandProfile } from "@/db/queries/brand-profiles";

type Props = {
  brands: BrandProfile[];
  onStart: (settings: RecordingSettings) => void;
};

const RESOLUTIONS: Resolution[] = ["1080p", "1440p", "4k"];
const SHAPES: BubbleShape[] = ["circle", "rounded-square", "rectangle", "hexagon"];
const SIZES: BubbleSize[] = ["small", "medium", "large"];
const POSITIONS = [
  { label: "Top left", x: 0.08, y: 0.12 },
  { label: "Top right", x: 0.92, y: 0.12 },
  { label: "Bottom left", x: 0.08, y: 0.88 },
  { label: "Bottom right", x: 0.92, y: 0.88 },
];

export function PreRecordForm({ brands, onStart }: Props) {
  const [settings, setSettings] = useState<RecordingSettings>(DEFAULT_SETTINGS);

  const update = <K extends keyof RecordingSettings>(
    key: K,
    value: RecordingSettings[K]
  ) => setSettings((s) => ({ ...s, [key]: value }));

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_1fr]">
      <div className="space-y-5">
        <Group label="Resolution">
          <Segmented
            options={RESOLUTIONS.map((r) => ({ value: r, label: r.toUpperCase() }))}
            value={settings.resolution}
            onChange={(v) => update("resolution", v as Resolution)}
          />
          {settings.resolution === "4k" && (
            <p className="mt-1 text-xs opacity-60">
              4K uses significant CPU — if you see dropped frames, drop to 1440p.
            </p>
          )}
        </Group>

        <Group label="Camera">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.cameraEnabled}
              onChange={(e) => update("cameraEnabled", e.target.checked)}
            />
            Include camera bubble
          </label>
        </Group>

        {settings.cameraEnabled && (
          <>
            <Group label="Bubble shape">
              <Segmented
                options={SHAPES.map((s) => ({
                  value: s,
                  label: s === "rounded-square" ? "R-square" : s,
                }))}
                value={settings.bubbleShape}
                onChange={(v) => update("bubbleShape", v as BubbleShape)}
              />
            </Group>

            <Group label="Bubble size">
              <Segmented
                options={SIZES.map((s) => ({ value: s, label: s }))}
                value={settings.bubbleSize}
                onChange={(v) => update("bubbleSize", v as BubbleSize)}
              />
            </Group>

            <Group label="Bubble position">
              <div className="grid grid-cols-2 gap-2">
                {POSITIONS.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() =>
                      update("bubblePosition", { x: p.x, y: p.y })
                    }
                    className={
                      Math.abs(settings.bubblePosition.x - p.x) < 0.01 &&
                      Math.abs(settings.bubblePosition.y - p.y) < 0.01
                        ? "rounded border border-white/60 px-3 py-1.5 text-xs"
                        : "rounded border border-white/15 px-3 py-1.5 text-xs hover:border-white/40"
                    }
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </Group>
          </>
        )}

        <Group label="System audio">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.systemAudioEnabled}
              onChange={(e) => update("systemAudioEnabled", e.target.checked)}
            />
            Capture audio from apps (Chrome only; you&apos;ll be asked to share
            a tab or the whole screen with audio)
          </label>
        </Group>

        <Group label="Brand profile (optional)">
          <select
            value={settings.brandProfileId ?? ""}
            onChange={(e) =>
              update("brandProfileId", e.target.value || null)
            }
            className="w-full rounded border border-white/20 bg-transparent px-3 py-2 text-sm outline-none focus:border-white/40"
          >
            <option value="">None</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Group>
      </div>

      <div className="space-y-4">
        <Group label="Preview">
          <BubblePreview settings={settings} />
        </Group>

        <button
          type="button"
          onClick={() => onStart(settings)}
          className="w-full rounded bg-red-500/90 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-500"
        >
          Start recording
        </button>
      </div>
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-sm font-medium">{label}</div>
      {children}
    </div>
  );
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded border border-white/15 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={
            o.value === value
              ? "rounded bg-white/90 px-3 py-1.5 text-xs capitalize text-black"
              : "rounded px-3 py-1.5 text-xs capitalize opacity-70 hover:opacity-100"
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run typecheck
```
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/components/record/pre-record-form.tsx
git commit -m "feat(record): add pre-record settings form"
```

---

### Task 10: Countdown component

**Files:**
- Create: `src/components/record/countdown.tsx`

- [ ] **Step 1: Create the component**

```typescript
"use client";

import { useEffect, useState } from "react";

export function Countdown({
  seconds,
  onComplete,
}: {
  seconds: number;
  onComplete: () => void;
}) {
  const [remaining, setRemaining] = useState(seconds);

  useEffect(() => {
    if (remaining <= 0) {
      onComplete();
      return;
    }
    const t = setTimeout(() => setRemaining((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [remaining, onComplete]);

  return (
    <div className="flex min-h-[300px] items-center justify-center">
      <div
        key={remaining}
        className="text-8xl font-bold tabular-nums"
        style={{ animation: "pulse 1s ease-out" }}
      >
        {remaining > 0 ? remaining : "Go"}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run typecheck
```
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/components/record/countdown.tsx
git commit -m "feat(record): add countdown component"
```

---

### Task 11: Recording HUD component

**Files:**
- Create: `src/components/record/recording-hud.tsx`

- [ ] **Step 1: Create the component**

```typescript
"use client";

import { useEffect, useState } from "react";

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function RecordingHud({
  startedAt,
  onStop,
}: {
  startedAt: number;
  onStop: () => void;
}) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setElapsed((performance.now() - startedAt) / 1000);
    }, 250);
    return () => clearInterval(id);
  }, [startedAt]);

  return (
    <div className="flex min-h-[300px] flex-col items-center justify-center gap-6">
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="h-3 w-3 animate-pulse rounded-full bg-red-500"
        />
        <span className="text-2xl font-semibold tabular-nums">
          {formatElapsed(elapsed)}
        </span>
      </div>
      <p className="max-w-md text-center text-sm opacity-60">
        Recording in progress. Click stop below or end screen sharing from the
        browser bar to finalise the recording.
      </p>
      <button
        type="button"
        onClick={onStop}
        className="rounded bg-red-500/90 px-6 py-2 text-sm font-medium text-white hover:bg-red-500"
      >
        Stop recording
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run typecheck
```
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/components/record/recording-hud.tsx
git commit -m "feat(record): add recording HUD component"
```

---

### Task 12: Finished view component

**Files:**
- Create: `src/components/record/finished-view.tsx`

- [ ] **Step 1: Create the component**

```typescript
"use client";

import { useEffect, useState } from "react";
import type { RecordingResult, TrackKind } from "@/lib/recording/types";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function trackLabel(kind: TrackKind): string {
  switch (kind) {
    case "composite": return "Composite (share-ready)";
    case "screen": return "Raw screen video";
    case "camera": return "Raw camera video";
    case "mic": return "Raw microphone audio";
    case "system-audio": return "Raw system audio";
  }
}

export function FinishedView({
  result,
  onReset,
}: {
  result: RecordingResult;
  onReset: () => void;
}) {
  // Revoke object URLs when component unmounts to avoid memory leaks.
  const [urls] = useState(() =>
    result.tracks.map((t) => ({ kind: t.kind, url: URL.createObjectURL(t.blob), sizeBytes: t.sizeBytes, mimeType: t.mimeType }))
  );

  useEffect(() => {
    return () => {
      for (const u of urls) URL.revokeObjectURL(u.url);
    };
  }, [urls]);

  const composite = urls.find((u) => u.kind === "composite");

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Recording ready</h2>
        <p className="mt-1 text-sm opacity-60">
          Duration: {result.durationSeconds.toFixed(1)}s · Resolution:{" "}
          {result.settings.resolution.toUpperCase()} · {urls.length} track
          {urls.length === 1 ? "" : "s"}
        </p>
      </div>

      {composite && (
        <video
          src={composite.url}
          controls
          className="w-full rounded border border-white/10 bg-black"
        />
      )}

      <div>
        <h3 className="text-sm font-medium">Downloads</h3>
        <ul className="mt-2 grid gap-2">
          {urls.map((u) => (
            <li
              key={u.kind}
              className="flex items-center justify-between rounded border border-white/10 p-3"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium">{trackLabel(u.kind)}</div>
                <div className="mt-0.5 text-xs opacity-60">
                  {u.mimeType} · {formatBytes(u.sizeBytes)}
                </div>
              </div>
              <a
                href={u.url}
                download={`loom-${result.settings.resolution}-${u.kind}.webm`}
                className="rounded border border-white/20 px-3 py-1.5 text-xs hover:bg-white/5"
              >
                Download
              </a>
            </li>
          ))}
        </ul>
      </div>

      <button
        type="button"
        onClick={onReset}
        className="rounded border border-white/20 px-4 py-2 text-sm hover:bg-white/5"
      >
        New recording
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run typecheck
```
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/components/record/finished-view.tsx
git commit -m "feat(record): add finished-view with downloads"
```

---

### Task 13: Record flow state machine

**Files:**
- Create: `src/components/record/record-flow.tsx`

- [ ] **Step 1: Create the component**

```typescript
"use client";

import { useCallback, useReducer, useRef } from "react";
import type {
  RecorderState,
  RecordingSettings,
  RecordingResult,
} from "@/lib/recording/types";
import {
  startRecording,
  type RecorderHandle,
} from "@/lib/recording/recorder";
import { CaptureError } from "@/lib/recording/capture-streams";
import type { BrandProfile } from "@/db/queries/brand-profiles";
import { PreRecordForm } from "./pre-record-form";
import { Countdown } from "./countdown";
import { RecordingHud } from "./recording-hud";
import { FinishedView } from "./finished-view";

type Action =
  | { type: "start-countdown"; settings: RecordingSettings }
  | { type: "begin-recording"; startedAt: number }
  | { type: "finish"; result: RecordingResult }
  | { type: "error"; message: string }
  | { type: "reset" };

function reducer(state: RecorderState, action: Action): RecorderState {
  switch (action.type) {
    case "start-countdown":
      return { kind: "countdown", secondsLeft: 3 };
    case "begin-recording":
      return { kind: "recording", startedAt: action.startedAt };
    case "finish":
      return { kind: "finished", result: action.result };
    case "error":
      return { kind: "error", message: action.message };
    case "reset":
      return { kind: "idle" };
  }
}

export function RecordFlow({ brands }: { brands: BrandProfile[] }) {
  const [state, dispatch] = useReducer(reducer, { kind: "idle" } as RecorderState);
  const handleRef = useRef<RecorderHandle | null>(null);
  const pendingSettingsRef = useRef<RecordingSettings | null>(null);

  const onStart = useCallback((settings: RecordingSettings) => {
    pendingSettingsRef.current = settings;
    dispatch({ type: "start-countdown", settings });
  }, []);

  const onCountdownDone = useCallback(async () => {
    const settings = pendingSettingsRef.current;
    if (!settings) return;
    try {
      const handle = await startRecording(settings);
      handleRef.current = handle;
      dispatch({ type: "begin-recording", startedAt: performance.now() });
      // If user revokes screen share mid-recording, handle.settled resolves.
      handle.settled.then(() => {
        if (handleRef.current === handle) {
          // Already finishing via our own stop button, nothing to do.
        }
      });
    } catch (err) {
      const message =
        err instanceof CaptureError
          ? err.message
          : `Failed to start recording: ${String(err)}`;
      dispatch({ type: "error", message });
    }
  }, []);

  const onStop = useCallback(async () => {
    const handle = handleRef.current;
    if (!handle) return;
    const result = await handle.stop();
    handleRef.current = null;
    dispatch({ type: "finish", result });
  }, []);

  const onReset = useCallback(() => {
    handleRef.current = null;
    pendingSettingsRef.current = null;
    dispatch({ type: "reset" });
  }, []);

  if (state.kind === "idle") {
    return <PreRecordForm brands={brands} onStart={onStart} />;
  }
  if (state.kind === "countdown") {
    return <Countdown seconds={state.secondsLeft} onComplete={onCountdownDone} />;
  }
  if (state.kind === "recording") {
    return <RecordingHud startedAt={state.startedAt} onStop={onStop} />;
  }
  if (state.kind === "finished") {
    return <FinishedView result={state.result} onReset={onReset} />;
  }
  // error
  return (
    <div className="mx-auto max-w-lg space-y-4 p-6 text-center">
      <h2 className="text-xl font-semibold">Couldn&apos;t start recording</h2>
      <p className="text-sm opacity-70">{state.message}</p>
      <button
        type="button"
        onClick={onReset}
        className="rounded border border-white/20 px-4 py-2 text-sm hover:bg-white/5"
      >
        Try again
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run typecheck
```
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/components/record/record-flow.tsx
git commit -m "feat(record): add state machine orchestrator"
```

---

### Task 14: Record page (server component)

**Files:**
- Create: `src/app/record/page.tsx`

- [ ] **Step 1: Create the page**

```typescript
import { requireAuth } from "@/lib/require-auth";
import { listBrandProfiles } from "@/db/queries/brand-profiles";
import { TopNav } from "@/components/nav/top-nav";
import { RecordFlow } from "@/components/record/record-flow";

export default async function RecordPage() {
  const user = await requireAuth();
  const brands = await listBrandProfiles(user.id);
  return (
    <>
      <TopNav userEmail={user.email ?? "unknown"} activePath="record" />
      <div className="mx-auto max-w-4xl p-6">
        <h1 className="text-2xl font-semibold">New recording</h1>
        <p className="mt-1 text-sm opacity-60">
          Recording runs in your browser. Blobs stay local until upload ships in M4.
        </p>
        <div className="mt-6">
          <RecordFlow brands={brands} />
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run typecheck
```
Expected: FAIL — `TopNav` doesn't accept `"record"` as an `activePath` value yet. We fix that in Task 15.

- [ ] **Step 3: Stage but don't commit yet** (commit after Task 15 so the repo always typechecks):

(No commit — leave the files staged or unstaged; next task adds the missing type union member.)

---

### Task 15: Extend top nav with Record link

**Files:**
- Modify: `src/components/nav/top-nav.tsx`

- [ ] **Step 1: Replace the component**

```typescript
import Link from "next/link";

type Props = {
  userEmail: string;
  activePath: "recordings" | "brands" | "record";
};

export function TopNav({ userEmail, activePath }: Props) {
  const items = [
    { href: "/record", label: "Record", key: "record" as const },
    { href: "/", label: "Recordings", key: "recordings" as const },
    { href: "/brands", label: "Brands", key: "brands" as const },
  ];

  return (
    <nav className="flex items-center justify-between border-b border-white/10 px-6 py-3">
      <div className="flex items-center gap-6">
        <Link href="/" className="text-sm font-semibold">
          Loom Clone
        </Link>
        <ul className="flex items-center gap-4">
          {items.map((item) => (
            <li key={item.key}>
              <Link
                href={item.href}
                className={
                  item.key === activePath
                    ? "text-sm font-medium"
                    : "text-sm opacity-60 hover:opacity-100"
                }
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs opacity-60">{userEmail}</span>
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="rounded border border-white/20 px-2.5 py-1 text-xs hover:bg-white/5"
          >
            Sign out
          </button>
        </form>
      </div>
    </nav>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run typecheck
```
Expected: exits 0.

- [ ] **Step 3: Commit Tasks 14 + 15 together**

```bash
git add src/app/record/page.tsx src/components/nav/top-nav.tsx
git commit -m "feat(record): add /record page and Record nav link"
```

---

### Task 16: Update dashboard CTA

**Files:**
- Modify: `src/components/dashboard/empty-state.tsx`

- [ ] **Step 1: Add a prominent "Record" link**

```typescript
import Link from "next/link";

export function EmptyState() {
  return (
    <div className="mx-auto max-w-2xl p-6">
      <div>
        <h1 className="text-2xl font-semibold">Recordings</h1>
        <p className="mt-1 text-sm opacity-60">
          Recording lands in your browser; upload + sharing arrive in Milestones 4–11.
        </p>
      </div>
      <div className="mt-8 rounded-lg border border-white/10 p-6">
        <h2 className="text-sm font-medium">Current milestone</h2>
        <p className="mt-1 text-sm opacity-80">
          M3: Browser recording capture (no upload yet)
        </p>
        <Link
          href="/record"
          className="mt-4 inline-block rounded bg-red-500/90 px-4 py-2 text-sm font-medium text-white hover:bg-red-500"
        >
          Start a recording
        </Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run typecheck
```
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/components/dashboard/empty-state.tsx
git commit -m "feat(dashboard): add Record CTA"
```

---

### Task 17: E2E smoke test for recording flow (fake media streams)

**Files:**
- Modify: `playwright.config.ts`
- Create: `tests/e2e/record.spec.ts`

- [ ] **Step 1: Add Chromium fake-media launch args**

Modify `playwright.config.ts`:

```typescript
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  retries: 0,
  workers: 1,
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        browserName: "chromium",
        launchOptions: {
          args: [
            "--use-fake-device-for-media-stream",
            "--use-fake-ui-for-media-stream",
            "--auto-accept-this-tab-capture",
          ],
        },
        permissions: ["camera", "microphone"],
      },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000/api/health",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
```

- [ ] **Step 2: Write the failing E2E test**

Create `tests/e2e/record.spec.ts`:

```typescript
import { test, expect } from "@playwright/test";

const TEST_EMAIL = process.env.TEST_CREATOR_EMAIL;
const TEST_PASSWORD = process.env.TEST_CREATOR_PASSWORD;

test.describe("recording capture flow", () => {
  test.skip(
    !TEST_EMAIL || !TEST_PASSWORD,
    "requires TEST_CREATOR_EMAIL + TEST_CREATOR_PASSWORD env vars"
  );

  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(TEST_EMAIL!);
    await page.getByLabel("Password").fill(TEST_PASSWORD!);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL("/");
  });

  test("state machine progresses idle → countdown → recording → finished", async ({ page }) => {
    await page.goto("/record");
    await expect(page.getByRole("heading", { name: "New recording" })).toBeVisible();

    // 1080p keeps the test fast and avoids 4K issues in CI Chromium.
    // Default resolution is already 1080p.
    await page.getByRole("button", { name: "Start recording" }).click();

    // Countdown is 3 seconds, then recording begins. Wait for the stop button.
    await expect(
      page.getByRole("button", { name: "Stop recording" })
    ).toBeVisible({ timeout: 10_000 });

    // Record for ~2 seconds.
    await page.waitForTimeout(2_000);

    await page.getByRole("button", { name: "Stop recording" }).click();

    // Finished view appears with at least a composite download link.
    await expect(
      page.getByRole("heading", { name: "Recording ready" })
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole("link", { name: "Download" }).first()
    ).toBeVisible();

    // Reset returns to form.
    await page.getByRole("button", { name: "New recording" }).click();
    await expect(
      page.getByRole("button", { name: "Start recording" })
    ).toBeVisible();
  });
});
```

- [ ] **Step 3: Run the E2E test**

```bash
set -a && source .env.local && set +a
npm run test:e2e -- tests/e2e/record.spec.ts
```

Expected: the test passes. If it fails due to `getDisplayMedia` not being auto-accepted (Chromium's `--auto-accept-this-tab-capture` only works for tab capture in some versions), the fallback is to manually verify via local `npm run dev` and mark the test as `test.skip` with a comment explaining why. **Do NOT land a broken test.**

- [ ] **Step 4: Commit**

```bash
git add playwright.config.ts tests/e2e/record.spec.ts
git commit -m "test(e2e): record flow state-machine smoke test"
```

If the test had to be skipped due to Chromium limitations, still commit it with the skip and a TODO note for Task 18's manual validation.

---

### Task 18: 4K stress test (manual validation)

**Files:** none

This is the spec's Milestone 0. Run on the M4 Pro Mac mini locally before the deploy task.

- [ ] **Step 1: Start dev server**

```bash
cd /Users/iancross/Development/03Utilities/Loom_Clone
npm run dev
```

- [ ] **Step 2: In Chrome, log in and visit /record**

- [ ] **Step 3: Set resolution to 4K, camera ON, size medium, bubble position bottom-right, system audio ON**

- [ ] **Step 4: Click Start recording**
- Grant screen sharing (pick the whole display, check "share audio")
- Grant camera + mic access

- [ ] **Step 5: Record for 10 full minutes while using the machine normally (scrolling, switching apps, playing a video with system audio).**

- [ ] **Step 6: Click Stop**

- [ ] **Step 7: In the Finished view, inspect each download:**
  - Composite file size at 10 mbps × 10 min × 60 s ≈ 750 MB (expected)
  - Download the composite and play it; confirm no visible frame drops, bubble positioned correctly, audio synced
  - Download raw screen; confirm no bubble (just screen), audio absent
  - Download raw camera; confirm bubble-free camera at ~1080p
  - Download raw mic; confirm audible
  - If system audio was captured, download it; confirm audible

- [ ] **Step 8: Open Chrome DevTools → Performance tab during a second recording attempt, capture a 30-second profile, and check for:**
  - Long tasks >100ms in the main thread
  - Dropped frames on the canvas.captureStream
  - Memory usage trend (shouldn't grow unbounded)

**Pass criteria:** composite plays smoothly, ≤5% dropped frames in Performance profile, audio stays synced.

**If fail:** apply the spec's contingency tiers in order, committing each tier as a separate fix. The tiers are documented in the spec as:
1. Composite stays 4K, raw screen drops to 1440p (modify `capture-streams.ts` to cap raw screen's `extractTracks` result at 1440p via a separate getDisplayMedia request — only do this if tier 1 is actually necessary).
2. Composite drops to 1440p, raw tracks unchanged.
3. Composite drops to 1080p, raw tracks unchanged.

Apply tiers one at a time, re-testing at 10 min each. Log in `docs/superpowers/notes/m3-4k-validation.md` which tier the app settled on.

- [ ] **Step 9 (if all passed): Document the result**

Create `docs/superpowers/notes/m3-4k-validation.md`:

```markdown
# M3 4K Stress Validation

**Date:** <today>
**Hardware:** Mac mini M4 Pro, 48GB RAM
**Browser:** Chrome <version>

**Result:** PASS at tier 0 (composite 4K + raw screen 4K + raw camera 1080p + mic + system audio)

- Composite: <actual size> MB for 10 min
- Dropped frames: <N>%
- Memory: <peak> MB / stable trend: yes/no

No contingency tiers needed.
```

(Or if a tier was applied, document which one and why.)

- [ ] **Step 10: Commit validation notes**

```bash
git add docs/superpowers/notes/
git commit -m "docs: M3 4K stress test validation results"
```

---

### Task 19: Push + verify live

**Files:** none

- [ ] **Step 1: Push**

```bash
git push
```

- [ ] **Step 2: Wait for Coolify deploy + CI**

```bash
gh run list --repo Deducer/loom-clone --limit 1
```
Expected: `completed success` after ~30s.

Watch https://coolify.dissonance.cloud until the deployment shows "Running" (~3 min).

- [ ] **Step 3: Visit live app**

Navigate to https://loom.dissonance.cloud/record in Chrome:
- Should show the top nav with Record / Recordings / Brands
- Form renders with bubble preview
- Click Start recording, grant perms, record ~5s, stop, see download links
- Download the composite and verify it plays

- [ ] **Step 4: Update project CLAUDE.md**

```bash
sed -i '' 's|- \[ \] M3: Recording capture.*|- [x] **M3: Recording capture** — browser capture + bubble compositing + parallel raw tracks|' CLAUDE.md
git add CLAUDE.md
git commit -m "docs: mark M3 complete in roadmap"
git push
```

---

## Milestone 3 Complete

At this point you should have:

- A working `/record` page that captures screen + camera + audio into 4-5 parallel `MediaRecorder` instances, composites the bubble live, and hands you downloadable blobs for each track
- 4K stress test passed (or contingency tier applied and documented)
- E2E test validating the idle → countdown → recording → finished state machine
- 15 Vitest tests passing (existing 8 + new 7 for bubble shapes)
- Live at https://loom.dissonance.cloud/record

Re-invoke `/superpowers:writing-plans` with "M4: R2 upload pipeline" when ready. M4 takes the blobs from M3 and uploads them directly to Cloudflare R2 via multipart, creates the `media_objects` row, and persists brand profile selection.

---

## Self-Review

**Spec coverage (Milestone 3 scope only):**

- Browser APIs used per spec — `getDisplayMedia`, `getUserMedia`, `OffscreenCanvas` variant via `<canvas>`, `MediaRecorder` × 4-5, `@aws-sdk/lib-storage` NOT yet (deferred to M4) → Tasks 4-7 ✓
- UI flow per spec — home → pre-record modal → countdown → recording view → finished page → Tasks 9, 10, 11, 12, 13, 14 ✓
- Pre-record modal options: resolution (1080p/1440p/4k), camera shape (4 options), size (3 options), position (4 corners), system audio toggle, brand profile dropdown → Task 9 ✓
- 3-second countdown → Task 10 ✓
- HUD as separate DOM element not drawn into canvas → Task 11 (separate component, not canvas content) ✓
- WebM (VP9 + Opus) output → Task 7 (VP9_MIME constant) ✓
- Compositing at 30fps, not 60 → Task 6 (`canvas.captureStream(30)`) ✓
- Camera bubble baked into composite at record time → Task 6 (drawn to canvas) ✓
- Parallel MediaRecorders outputting to separate blobs → Task 7 (slots array) ✓
- 4K concern contingency tiers → Task 18 step "If fail" ✓
- "Chrome-only system-audio capture" noted in UI → Task 9 help text ✓
- Brand profile selection stored with recording metadata (for M4 upload) → Task 1 (settings), Task 9 (dropdown) ✓

**Gaps explicitly deferred to future milestones (correct per spec Scope Fence):**
- Upload during recording (multipart to R2) — M4
- DB `media_objects` row creation — M4
- Countdown customization — not in scope per spec
- Draw/annotation during recording — not in scope per spec
- Pause across recordings — not in scope per spec

**Placeholder scan:** No TBD / TODO / "implement later" / "similar to Task N" in the plan. Every step has complete code or explicit commands.

**Type/name consistency:**
- `RecordingSettings` (Task 1) consumed by Tasks 6, 7, 9, 12, 13 — all use the same field names (`resolution`, `cameraEnabled`, `bubbleShape`, `bubbleSize`, `bubblePosition`, `systemAudioEnabled`, `brandProfileId`). ✓
- `RecordingResult` (Task 1) produced by Task 7 (`startRecording` → `RecorderHandle` → `stop(): Promise<RecordingResult>`), consumed by Tasks 12, 13. ✓
- `TrackKind` enum (Task 1) used in Tasks 7 (slots), 12 (`trackLabel`). All 5 kinds handled in both. ✓
- `BubbleShape` (Task 1) enum consumed by Tasks 2, 8, 9. All 4 shapes handled everywhere. ✓
- `BubbleSize` (Task 1) consumed by Tasks 6 (`BUBBLE_SIZE_FRACTION` lookup), 8, 9. All 3 sizes handled. ✓
- `Resolution` (Task 1) consumed by Tasks 4 (`captureScreen`), 6 (`startCompositor`), 9, 12. All 3 resolutions handled. ✓
- `RecorderState` (Task 1) consumed by Task 13 reducer — all 5 `kind` values (`idle`, `countdown`, `recording`, `finished`, `error`) covered in the render switch. ✓
- `CaptureError` (Task 4) thrown from Task 7 and caught in Task 13's `onCountdownDone`. ✓
- `TopNav` `activePath` prop (Task 15) widens to `"recordings" | "brands" | "record"` — all three page components pass a valid value (`"recordings"` on `/`, `"brands"` on `/brands*`, `"record"` on `/record`). ✓
- `createBubblePath` signature (Task 2) matches consumers in Tasks 6, 8 (`shape, cx, cy, diameter`). ✓
- `getBubbleBounds` signature (Task 2) matches consumer in Task 6. ✓

No inconsistencies found.

**One deliberate footgun worth highlighting:** Task 14 will fail typecheck on its own — it passes `"record"` to `TopNav`, but `TopNav`'s union doesn't yet include that value. Task 15 fixes the union. The plan asks engineers to NOT commit Task 14 alone, commit 14+15 together so every commit in history typechecks. The TDD "fail first, pass second" rhythm doesn't work here because we can't write a failing TypeScript type assertion at commit time. This is an intentional compromise.
