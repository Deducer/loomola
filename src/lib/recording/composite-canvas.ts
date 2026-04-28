import type { RecordingSettings, BubblePosition } from "./types";
import { RESOLUTION_DIMENSIONS } from "./types";

/**
 * A mutable position holder shared between the React UI and the
 * compositor's worker. The setter on `current` posts the new value to
 * the worker so the next composite frame uses it; the getter returns
 * the last value written (used by callers that want to render a hint
 * in the main-thread UI).
 */
export type BubblePositionController = { current: BubblePosition };

type CompositeHandles = {
  stream: MediaStream;
  stop: () => void;
  positionController: BubblePositionController;
};

/**
 * Starts the off-thread compositor.
 *
 * Architecturally:
 *
 *   screen track ──MediaStreamTrackProcessor──┐
 *                                              ├──► Worker (OffscreenCanvas
 *   camera track ──MediaStreamTrackProcessor──┤      drawing loop) ──► writes
 *                                              │      VideoFrames into
 *   MediaStreamTrackGenerator.writable ◄──────┘      generator.writable
 *           │
 *           └─► generator (a MediaStreamTrack) ──► returned in MediaStream
 *
 * The reason we go through this dance instead of drawing on a main-thread
 * canvas is tab-throttling. When /record is a background tab, Chrome
 * throttles requestAnimationFrame to ~1 Hz and pauses HTMLVideoElement
 * frame production, so the previous compositor froze the recording on
 * whichever frame happened to be on the canvas when the user tabbed
 * away. Workers aren't subject to host-tab throttling, so the composite
 * keeps running at the screen track's native frame rate.
 *
 * Chrome-only: requires MediaStreamTrackProcessor / Generator and
 * OffscreenCanvas. We're already Chrome-only by design (system audio
 * + Document PiP), so this constraint is consistent with the rest of
 * the recording pipeline.
 */
export function startCompositor(
  screenStream: MediaStream,
  cameraStream: MediaStream | null,
  settings: RecordingSettings
): CompositeHandles {
  ensureSupported();
  const { width, height } = RESOLUTION_DIMENSIONS[settings.resolution];

  const screenTrack = screenStream.getVideoTracks()[0];
  if (!screenTrack) throw new Error("screen stream has no video track");
  const cameraTrack =
    cameraStream && settings.cameraEnabled
      ? (cameraStream.getVideoTracks()[0] ?? null)
      : null;

  // MediaStreamTrackProcessor's .readable can be transferred to a worker;
  // the processor itself stays alive on the main thread (it's the source
  // feeding the readable). Holding refs in `keepalive` so they aren't GC'd.
  const screenProcessor = new MediaStreamTrackProcessor({ track: screenTrack });
  const cameraProcessor = cameraTrack
    ? new MediaStreamTrackProcessor({ track: cameraTrack })
    : null;
  const generator = new MediaStreamTrackGenerator({ kind: "video" });

  const worker = new Worker(
    new URL("./composite.worker.ts", import.meta.url),
    { type: "module" }
  );
  worker.addEventListener("message", (event: MessageEvent) => {
    if (event.data?.type === "error") {
      console.error("[composite-worker]", event.data.message);
    }
  });
  worker.addEventListener("error", (event) => {
    console.error("[composite-worker] error event:", event.message);
  });

  const transfers: Transferable[] = [
    screenProcessor.readable,
    generator.writable,
  ];
  if (cameraProcessor) transfers.push(cameraProcessor.readable);

  worker.postMessage(
    {
      type: "init",
      width,
      height,
      bubbleShape: settings.bubbleShape,
      bubbleSize: settings.bubbleSize,
      cameraEnabled: !!cameraTrack,
      initialPosition: { ...settings.bubblePosition },
      screenReadable: screenProcessor.readable,
      cameraReadable: cameraProcessor?.readable ?? null,
      outputWritable: generator.writable,
    },
    transfers
  );

  // The generator IS a MediaStreamTrack — wrap in a stream and we're done.
  const stream = new MediaStream([generator]);

  // Hold processor refs so they aren't GC'd while the worker is reading
  // the streams that drain through them. Lint won't see them used; that's
  // intentional — they're side-effect anchors.
  const keepalive = { screenProcessor, cameraProcessor };
  void keepalive;

  let _current: BubblePosition = { ...settings.bubblePosition };
  const positionController: BubblePositionController = {
    get current() {
      return _current;
    },
    set current(pos: BubblePosition) {
      _current = pos;
      worker.postMessage({ type: "position", position: pos });
    },
  };

  return {
    stream,
    stop: () => {
      worker.postMessage({ type: "stop" });
      // Backstop: the worker self-closes after flushing, but if it's
      // unresponsive (e.g. a write hang) make sure we tear it down.
      setTimeout(() => worker.terminate(), 200);
    },
    positionController,
  };
}

function ensureSupported(): void {
  if (
    typeof MediaStreamTrackProcessor === "undefined" ||
    typeof MediaStreamTrackGenerator === "undefined" ||
    typeof OffscreenCanvas === "undefined"
  ) {
    throw new Error(
      "This browser doesn't support the WebCodecs / Insertable-Streams APIs needed for recording. Use Chrome 94+."
    );
  }
}
