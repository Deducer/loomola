import type {
  RecordingSettings,
  RecordingResult,
  RecordedTrack,
  TrackKind,
} from "./types";
import {
  captureScreen,
  captureCameraAndMic,
  captureCameraOnly,
  captureMicOnly,
  stopStream,
  extractTracks,
  CaptureError,
} from "./capture-streams";
import { createAudioMixer } from "./audio-mixer";
import {
  startCompositor,
  type BubblePositionController,
} from "./composite-canvas";
import type { UploadCoordinator } from "./upload-coordinator";

const VP9_MIME = "video/webm;codecs=vp9,opus";
const OPUS_MIME = "audio/webm;codecs=opus";
const VIDEO_MIME_CANDIDATES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];
const AUDIO_MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
];
const VIDEO_BITRATES: Record<
  RecordingSettings["resolution"],
  Record<"composite" | "screen" | "camera", number>
> = {
  "1080p": { composite: 8_000_000, screen: 6_000_000, camera: 2_500_000 },
  "1440p": { composite: 14_000_000, screen: 10_000_000, camera: 3_500_000 },
  "4k": { composite: 28_000_000, screen: 20_000_000, camera: 5_000_000 },
};
const AUDIO_BITRATE = 128_000;

export type RecorderHandle = {
  stop: () => Promise<RecordingResult>;
  settled: Promise<void>;
};

export type PreparedRecording = {
  // Begins all MediaRecorders and starts the duration timer. Returns the
  // running handle. Permissions and stream wiring happened during prepare.
  start: () => RecorderHandle;
  // Tear down streams without ever starting the recorders (used if the
  // user aborts during countdown, or screen-share ends pre-record).
  abort: () => void;
  // The live screen + camera streams + the mutable bubble position
  // controller — exposed so the floating recording window can preview
  // the screen and drag the bubble during recording.
  screenStream: MediaStream;
  cameraStream: MediaStream | null;
  positionController: BubblePositionController;
};

type RecorderSlot = {
  kind: TrackKind;
  recorder: MediaRecorder;
  chunks: Blob[];
  mimeType: string;
};

export type StartRecordingOptions = {
  settings: RecordingSettings;
  /**
   * Optional: if provided, each MediaRecorder chunk is pushed into the
   * coordinator for streaming multipart upload to R2. Blobs are still
   * accumulated locally so the client has a RecordingResult at stop.
   */
  coordinator?: UploadCoordinator;
};

/**
 * Acquire all media streams (triggers browser permission prompts) and wire up
 * the compositor + mixer + MediaRecorders, but do NOT start recording yet.
 * The caller invokes `.start()` to begin (e.g. after a 3-2-1 countdown).
 */
export async function prepareRecording(
  opts: StartRecordingOptions
): Promise<PreparedRecording> {
  const { settings, coordinator } = opts;

  const screenStream = await captureScreen(
    settings.resolution,
    settings.systemAudioEnabled
  );
  // Camera + mic are independently togglable. The four combinations:
  //   - both on:  one getUserMedia call for video+audio
  //   - cam only: getUserMedia video-only
  //   - mic only: getUserMedia audio-only (camera bubble disabled)
  //   - both off: skip getUserMedia entirely
  let camStream: MediaStream | null = null;
  if (settings.cameraEnabled && settings.micEnabled) {
    camStream = await captureCameraAndMic(
      settings.cameraDeviceId,
      settings.micDeviceId
    );
  } else if (settings.cameraEnabled) {
    camStream = await captureCameraOnly(settings.cameraDeviceId);
  } else if (settings.micEnabled) {
    camStream = await captureMicOnly(settings.micDeviceId);
  }

  const screenVideoOnly = extractTracks(screenStream, "video");
  const screenAudioOnly = extractTracks(screenStream, "audio");
  const cameraVideoOnly =
    settings.cameraEnabled && camStream
      ? extractTracks(camStream, "video")
      : null;
  const micOnly =
    settings.micEnabled && camStream
      ? extractTracks(camStream, "audio")
      : null;

  const compositor = startCompositor(screenStream, camStream, settings);

  const mixer = createAudioMixer([micOnly, screenAudioOnly]);
  const compositeStream = new MediaStream([
    ...compositor.stream.getVideoTracks(),
    ...mixer.output.getAudioTracks(),
  ]);

  const slots: RecorderSlot[] = [];
  slots.push(makeSlot("composite", compositeStream, VP9_MIME, settings, coordinator));
  if (screenVideoOnly)
    slots.push(makeSlot("screen", screenVideoOnly, VP9_MIME, settings, coordinator));
  if (cameraVideoOnly)
    slots.push(makeSlot("camera", cameraVideoOnly, VP9_MIME, settings, coordinator));
  if (micOnly) slots.push(makeSlot("mic", micOnly, OPUS_MIME, settings, coordinator));
  if (screenAudioOnly)
    slots.push(
      makeSlot("system-audio", screenAudioOnly, OPUS_MIME, settings, coordinator)
    );

  let aborted = false;
  let started = false;

  const abort = () => {
    if (started || aborted) return;
    aborted = true;
    compositor.stop();
    mixer.dispose();
    stopStream(screenStream);
    stopStream(camStream);
  };

  // If the user closes Chrome's share picker / stops sharing during the
  // countdown, tear everything down cleanly.
  const primaryScreenTrack = screenStream.getVideoTracks()[0];
  if (primaryScreenTrack) {
    primaryScreenTrack.addEventListener(
      "ended",
      () => {
        if (!started) abort();
      },
      { once: true }
    );
  }

  return {
    start: () => {
      if (aborted) {
        throw new Error("prepared recording was aborted");
      }
      started = true;
      return beginRecording({
        slots,
        compositor,
        mixer,
        screenStream,
        camStream,
        settings,
        coordinator,
      });
    },
    abort,
    screenStream,
    cameraStream: settings.cameraEnabled ? camStream : null,
    positionController: compositor.positionController,
  };
}

/**
 * Backwards-compatible wrapper: prepares streams AND starts recording in one
 * await (legacy API; callers wanting the countdown should use
 * `prepareRecording` then `.start()` instead).
 */
export async function startRecording(
  opts: StartRecordingOptions
): Promise<RecorderHandle> {
  const prepared = await prepareRecording(opts);
  return prepared.start();
}

type BeginArgs = {
  slots: RecorderSlot[];
  compositor: ReturnType<typeof startCompositor>;
  mixer: ReturnType<typeof createAudioMixer>;
  screenStream: MediaStream;
  camStream: MediaStream | null;
  settings: RecordingSettings;
  coordinator?: UploadCoordinator;
};

function beginRecording(args: BeginArgs): RecorderHandle {
  const { slots, compositor, mixer, screenStream, camStream, settings, coordinator } = args;

  // 5-second timeslice so ondataavailable fires regularly for streaming uploads
  for (const s of slots) s.recorder.start(5000);

  const startTime = performance.now();
  let settledResolve: () => void = () => {};
  const settled = new Promise<void>((res) => (settledResolve = res));

  // Idempotent stop: repeated calls (e.g. user mashing the button, or
  // screen-share-ended firing after the user clicked Stop) return the same
  // in-flight promise. MediaRecorder.stop() on an already-stopped recorder
  // throws, which previously hung the whole chain.
  let stopPromise: Promise<RecordingResult> | null = null;

  const stop = (): Promise<RecordingResult> => {
    if (stopPromise) return stopPromise;

    stopPromise = new Promise<RecordingResult>((resolve, reject) => {
      const durationSeconds = (performance.now() - startTime) / 1000;

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
            try {
              if (slot.recorder.state !== "inactive") slot.recorder.stop();
            } catch (err) {
              console.error(`[recorder] MediaRecorder.stop() on ${slot.kind} threw:`, err);
            }
          })
      );

      Promise.all(stops)
        .then(async (tracks) => {
          compositor.stop();
          mixer.dispose();
          stopStream(screenStream);
          stopStream(camStream);

          // Flush any buffered parts through the coordinator. Use allSettled
          // so one track's upload failure doesn't hang the whole stop chain —
          // individual failures are logged; the caller gets back whatever
          // tracks finished (their local blobs are always available).
          if (coordinator) {
            const results = await Promise.allSettled(
              tracks.map((t) => coordinator.finalize(t.kind))
            );
            for (const [i, r] of results.entries()) {
              if (r.status === "rejected") {
                console.error(
                  `[recorder] finalize failed for ${tracks[i].kind}:`,
                  r.reason
                );
              }
            }
          }

          settledResolve();
          resolve({ durationSeconds, settings, tracks });
        })
        .catch((err) => {
          settledResolve();
          reject(err);
        });
    });

    return stopPromise;
  };

  const primaryScreenTrack = screenStream.getVideoTracks()[0];
  if (primaryScreenTrack) {
    primaryScreenTrack.addEventListener(
      "ended",
      () => {
        void stop().catch(() => {
          /* errors are surfaced via the explicit stop() call from the UI */
        });
      },
      { once: true }
    );
  }

  return { stop, settled };
}

function makeSlot(
  kind: TrackKind,
  stream: MediaStream,
  preferredMime: string,
  settings: RecordingSettings,
  coordinator?: UploadCoordinator
): RecorderSlot {
  const hasVideo = stream.getVideoTracks().length > 0;
  const hasAudio = stream.getAudioTracks().length > 0;
  const mimeType = pickSupportedMime(
    preferredMime,
    hasVideo ? VIDEO_MIME_CANDIDATES : AUDIO_MIME_CANDIDATES
  );
  const recorder = new MediaRecorder(stream, {
    ...(mimeType ? { mimeType } : {}),
    ...(hasVideo ? { videoBitsPerSecond: videoBitrate(kind, settings) } : {}),
    ...(hasAudio ? { audioBitsPerSecond: AUDIO_BITRATE } : {}),
  });
  const chunks: Blob[] = [];
  recorder.addEventListener("dataavailable", (evt) => {
    if (evt.data && evt.data.size > 0) {
      chunks.push(evt.data);
      coordinator?.pushChunk(kind, evt.data);
    }
  });
  return {
    kind,
    recorder,
    chunks,
    mimeType: mimeType || (hasVideo ? "video/webm" : "audio/webm"),
  };
}

function pickSupportedMime(preferredMime: string, candidates: string[]): string {
  if (MediaRecorder.isTypeSupported(preferredMime)) return preferredMime;
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? "";
}

function videoBitrate(kind: TrackKind, settings: RecordingSettings): number {
  if (kind === "camera") return VIDEO_BITRATES[settings.resolution].camera;
  if (kind === "screen") return VIDEO_BITRATES[settings.resolution].screen;
  return VIDEO_BITRATES[settings.resolution].composite;
}

export { CaptureError };
