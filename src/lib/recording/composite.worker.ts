/// <reference lib="webworker" />

/**
 * Off-thread compositor.
 *
 * Reads VideoFrames from the screen track via a transferred ReadableStream,
 * draws each frame into an OffscreenCanvas with aspect-preserving letterbox
 * fit, and writes the result to a transferred WritableStream fed by a
 * MediaStreamTrackGenerator on the main thread.
 *
 * Why a worker: when /record is a background tab, requestAnimationFrame
 * gets throttled to ~1 Hz and HTMLVideoElement frame production stops —
 * so the old main-thread compositor froze the entire recording on
 * whichever frame happened to be on the canvas when the user tabbed
 * away. Workers aren't subject to host-tab throttling, so the composite
 * keeps running at the screen track's native frame rate regardless of
 * what the user is doing.
 *
 * Why no camera/bubble drawing here: the Chrome extension injects a
 * /bubble iframe into the captured tab. That iframe lives in the screen
 * pixels getDisplayMedia gives us, so the bubble is in the recording
 * without us drawing it. The previous version overlaid a second bubble
 * here from the camera stream, which appeared as a duplicate in the
 * recording (often at a slightly different position from the iframe
 * one during drags / tab switches).
 */

type InitMessage = {
  type: "init";
  width: number;
  height: number;
  screenReadable: ReadableStream<VideoFrame>;
  outputWritable: WritableStream<VideoFrame>;
};

type StopMessage = { type: "stop" };

type WorkerMessage = InitMessage | StopMessage;

let stopped = false;

self.addEventListener("message", (event: MessageEvent<WorkerMessage>) => {
  const msg = event.data;
  if (msg.type === "init") {
    void runComposite(msg);
  } else if (msg.type === "stop") {
    stopped = true;
    setTimeout(() => (self as DedicatedWorkerGlobalScope).close(), 50);
  }
});

async function runComposite(init: InitMessage): Promise<void> {
  const canvas = new OffscreenCanvas(init.width, init.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    self.postMessage({
      type: "error",
      message: "OffscreenCanvas 2D context unavailable",
    });
    return;
  }
  const writer = init.outputWritable.getWriter();
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

    drawScreen(ctx, init, screenFrame);

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

  try {
    await writer.close();
  } catch {
    /* ignore */
  }
}

function drawScreen(
  ctx: OffscreenCanvasRenderingContext2D,
  init: InitMessage,
  screenFrame: VideoFrame
): void {
  const { width, height } = init;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);

  // Aspect-preserving fit-inside: drawing a 16:10 desktop straight into
  // a 16:9 canvas squishes the picture. Letterbox with the black we just
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
}

export {};
