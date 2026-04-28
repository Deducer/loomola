import type { RecordingSettings, BubblePosition } from "./types";
import { RESOLUTION_DIMENSIONS } from "./types";

/**
 * Mutable position holder retained for backwards-compatibility with
 * extension-bridge.tsx. The compositor itself no longer draws the
 * bubble — the Chrome extension's injected /bubble iframe is what
 * appears in the recording (it lives in the captured screen pixels).
 * The setter is a no-op apart from storing the last value, so any
 * future code that wants to know "where did the user drag the bubble
 * to" can still read positionController.current.
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
 *
 * Why no camera/bubble compositing here: the Chrome extension injects
 * a /bubble iframe directly into the captured tab(s). That iframe is
 * part of the screen pixels getDisplayMedia hands us, so the bubble
 * already shows up in the recording without us drawing anything.
 * Drawing a SECOND bubble in the compositor would duplicate the visible
 * bubble (often at slightly different positions during drags / tab
 * switches, which produced the "two bubbles" artifact). The
 * compositor's only job now is screen aspect-fit + letterbox.
 */
export function startCompositor(
  screenStream: MediaStream,
  _cameraStream: MediaStream | null,
  settings: RecordingSettings
): CompositeHandles {
  ensureSupported();
  const { width, height } = RESOLUTION_DIMENSIONS[settings.resolution];

  const screenTrack = screenStream.getVideoTracks()[0];
  if (!screenTrack) throw new Error("screen stream has no video track");

  const screenProcessor = new MediaStreamTrackProcessor({ track: screenTrack });
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

  worker.postMessage(
    {
      type: "init",
      width,
      height,
      screenReadable: screenProcessor.readable,
      outputWritable: generator.writable,
    },
    [screenProcessor.readable, generator.writable]
  );

  // The generator IS a MediaStreamTrack — wrap in a stream and we're done.
  const stream = new MediaStream([generator]);

  // Hold processor ref so it isn't GC'd while the worker is reading the
  // transferred readable stream that drains through it.
  const keepalive = { screenProcessor };
  void keepalive;

  let _current: BubblePosition = { ...settings.bubblePosition };
  const positionController: BubblePositionController = {
    get current() {
      return _current;
    },
    set current(pos: BubblePosition) {
      _current = pos;
    },
  };

  return {
    stream,
    stop: () => {
      worker.postMessage({ type: "stop" });
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
