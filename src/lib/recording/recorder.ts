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

  const stop = (): Promise<RecordingResult> =>
    new Promise<RecordingResult>((resolve) => {
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
            slot.recorder.stop();
          })
      );

      Promise.all(stops).then(async (tracks) => {
        compositor.stop();
        mixer.dispose();
        stopStream(screenStream);
        stopStream(camStream);

        // Flush any buffered parts through the coordinator
        if (coordinator) {
          await Promise.all(
            tracks.map((t) => coordinator.finalize(t.kind))
          );
        }

        settledResolve();
        resolve({ durationSeconds, settings, tracks });
      });
    });

  const primaryScreenTrack = screenStream.getVideoTracks()[0];
  if (primaryScreenTrack) {
    primaryScreenTrack.addEventListener(
      "ended",
      () => {
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
