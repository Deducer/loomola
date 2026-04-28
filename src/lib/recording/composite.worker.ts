/// <reference lib="webworker" />

import type { BubbleShape, BubbleSize, BubblePosition } from "./types";
import { BUBBLE_SIZE_FRACTION } from "./types";
import {
  createBubblePath,
  getBubbleBounds,
  clampBubbleCenter,
} from "./bubble-shapes";

/**
 * Off-thread compositor.
 *
 * Reads VideoFrames from screen + (optional) camera tracks via transferred
 * ReadableStreams, draws the screen + clipped camera bubble into an
 * OffscreenCanvas, and writes the result to a transferred WritableStream
 * fed by a MediaStreamTrackGenerator on the main thread.
 *
 * Why a worker: when /record is a background tab, requestAnimationFrame
 * gets throttled to ~1 Hz and <video> elements stop advancing — so the
 * old main-thread compositor froze the entire recording on whichever
 * frame was last drawn. Workers aren't subject to the host tab's
 * throttling, so the composite keeps running at the screen track's
 * native frame rate regardless of what the user is doing.
 *
 * The screen reader drives the output frame rate; we keep the most
 * recent camera frame and overlay it on every screen frame. If camera
 * is disabled, we just composite the screen onto the canvas.
 */

type InitMessage = {
  type: "init";
  width: number;
  height: number;
  bubbleShape: BubbleShape;
  bubbleSize: BubbleSize;
  cameraEnabled: boolean;
  initialPosition: BubblePosition;
  screenReadable: ReadableStream<VideoFrame>;
  cameraReadable: ReadableStream<VideoFrame> | null;
  outputWritable: WritableStream<VideoFrame>;
};

type PositionMessage = {
  type: "position";
  position: BubblePosition;
};

type StopMessage = { type: "stop" };

type WorkerMessage = InitMessage | PositionMessage | StopMessage;

let stopped = false;
let currentPosition: BubblePosition = { x: 0.85, y: 0.85 };
let cameraFrame: VideoFrame | null = null;

self.addEventListener("message", (event: MessageEvent<WorkerMessage>) => {
  const msg = event.data;
  if (msg.type === "init") {
    void runComposite(msg);
  } else if (msg.type === "position") {
    currentPosition = msg.position;
  } else if (msg.type === "stop") {
    stopped = true;
    if (cameraFrame) {
      try {
        cameraFrame.close();
      } catch {
        /* already closed */
      }
      cameraFrame = null;
    }
    // Self-terminate after a tick so any in-flight write can settle.
    setTimeout(() => (self as DedicatedWorkerGlobalScope).close(), 50);
  }
});

async function runComposite(init: InitMessage): Promise<void> {
  currentPosition = init.initialPosition;
  const canvas = new OffscreenCanvas(init.width, init.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    self.postMessage({
      type: "error",
      message: "OffscreenCanvas 2D context unavailable",
    });
    return;
  }
  const diameter = init.height * BUBBLE_SIZE_FRACTION[init.bubbleSize];
  const writer = init.outputWritable.getWriter();

  // Camera reader: just keeps the latest frame for the screen loop to draw.
  if (init.cameraEnabled && init.cameraReadable) {
    const cameraReader = init.cameraReadable.getReader();
    void (async () => {
      while (!stopped) {
        try {
          const { value, done } = await cameraReader.read();
          if (done || stopped) {
            if (value) {
              try {
                value.close();
              } catch {
                /* ignore */
              }
            }
            break;
          }
          if (cameraFrame) {
            try {
              cameraFrame.close();
            } catch {
              /* ignore */
            }
          }
          cameraFrame = value;
        } catch {
          break;
        }
      }
    })();
  }

  // Screen reader drives output. Each screen frame produces one composite frame.
  const screenReader = init.screenReadable.getReader();
  while (!stopped) {
    let screenFrame: VideoFrame;
    try {
      const result = await screenReader.read();
      if (result.done || stopped) break;
      screenFrame = result.value;
    } catch {
      break;
    }

    drawComposite(ctx, init, screenFrame, diameter);

    let outFrame: VideoFrame;
    try {
      outFrame = new VideoFrame(canvas, { timestamp: screenFrame.timestamp });
    } catch (err) {
      try {
        screenFrame.close();
      } catch {
        /* ignore */
      }
      self.postMessage({
        type: "error",
        message: `VideoFrame construction failed: ${String(err)}`,
      });
      break;
    }
    try {
      screenFrame.close();
    } catch {
      /* ignore */
    }

    try {
      await writer.ready;
      await writer.write(outFrame);
    } catch {
      try {
        outFrame.close();
      } catch {
        /* ignore */
      }
      break;
    }
  }

  if (cameraFrame) {
    try {
      cameraFrame.close();
    } catch {
      /* ignore */
    }
    cameraFrame = null;
  }
  try {
    await writer.close();
  } catch {
    /* ignore */
  }
}

function drawComposite(
  ctx: OffscreenCanvasRenderingContext2D,
  init: InitMessage,
  screenFrame: VideoFrame,
  diameter: number
): void {
  const { width, height } = init;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);

  // Aspect-preserving fit-inside: drawing a 16:10 desktop straight into a
  // 16:9 canvas squishes the picture. Letterbox with the black we just
  // painted as the surround.
  const sw = screenFrame.displayWidth || width;
  const sh = screenFrame.displayHeight || height;
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
  ctx.drawImage(screenFrame, dx, dy, dw, dh);

  if (cameraFrame && init.cameraEnabled) {
    const desiredCx = width * currentPosition.x;
    const desiredCy = height * currentPosition.y;
    const { cx, cy } = clampBubbleCenter(
      init.bubbleShape,
      desiredCx,
      desiredCy,
      diameter,
      width,
      height
    );
    const path = createBubblePath(init.bubbleShape, cx, cy, diameter);
    const bounds = getBubbleBounds(init.bubbleShape, cx, cy, diameter);

    ctx.save();
    ctx.clip(path);
    const vw = cameraFrame.displayWidth || 1;
    const vh = cameraFrame.displayHeight || 1;
    const scale = Math.max(bounds.width / vw, bounds.height / vh);
    const dwc = vw * scale;
    const dhc = vh * scale;
    const dxc = bounds.x + bounds.width / 2 - dwc / 2;
    const dyc = bounds.y + bounds.height / 2 - dhc / 2;
    ctx.drawImage(cameraFrame, dxc, dyc, dwc, dhc);
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = Math.max(2, height / 540);
    ctx.stroke(path);
    ctx.restore();
  }
}

export {};
