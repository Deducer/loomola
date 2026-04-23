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
import type { UploadCoordinator } from "./upload-coordinator";

const VP9_MIME = "video/webm;codecs=vp9,opus";
const OPUS_MIME = "audio/webm;codecs=opus";

export type RecorderHandle = {
  stop: () => Promise<RecordingResult>;
  settled: Promise<void>;
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

export async function startRecording(
  opts: StartRecordingOptions
): Promise<RecorderHandle> {
  const { settings, coordinator } = opts;

  const screenStream = await captureScreen(
    settings.resolution,
    settings.systemAudioEnabled
  );
  let camStream: MediaStream | null = null;
  if (settings.cameraEnabled) {
    camStream = await captureCameraAndMic(
      settings.cameraDeviceId,
      settings.micDeviceId
    );
  } else {
    camStream = await captureMicOnly(settings.micDeviceId);
  }

  const screenVideoOnly = extractTracks(screenStream, "video");
  const screenAudioOnly = extractTracks(screenStream, "audio");
  const cameraVideoOnly = settings.cameraEnabled
    ? extractTracks(camStream, "video")
    : null;
  const micOnly = extractTracks(camStream, "audio");

  const compositor = startCompositor(screenStream, camStream, settings);

  const mixer = createAudioMixer([micOnly, screenAudioOnly]);
  const compositeStream = new MediaStream([
    ...compositor.stream.getVideoTracks(),
    ...mixer.output.getAudioTracks(),
  ]);

  const slots: RecorderSlot[] = [];
  slots.push(makeSlot("composite", compositeStream, VP9_MIME, coordinator));
  if (screenVideoOnly)
    slots.push(makeSlot("screen", screenVideoOnly, VP9_MIME, coordinator));
  if (cameraVideoOnly)
    slots.push(makeSlot("camera", cameraVideoOnly, VP9_MIME, coordinator));
  if (micOnly) slots.push(makeSlot("mic", micOnly, OPUS_MIME, coordinator));
  if (screenAudioOnly)
    slots.push(
      makeSlot("system-audio", screenAudioOnly, OPUS_MIME, coordinator)
    );

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
  coordinator?: UploadCoordinator
): RecorderSlot {
  const mimeType = MediaRecorder.isTypeSupported(preferredMime)
    ? preferredMime
    : "";
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: Blob[] = [];
  recorder.addEventListener("dataavailable", (evt) => {
    if (evt.data && evt.data.size > 0) {
      chunks.push(evt.data);
      coordinator?.pushChunk(kind, evt.data);
    }
  });
  return { kind, recorder, chunks, mimeType: mimeType || "video/webm" };
}

export { CaptureError };
