import { spawn } from "node:child_process";
import { presignGet } from "@/lib/r2/presigned-get";
import { uploadBytes } from "@/lib/r2/upload-bytes";
import {
  ACTIVITY_FRAME_MS,
  decodeActivity,
  encodeActivity,
  PcmFrameAccumulator,
  type ActivityFrames,
} from "./activity";

const ffmpegPath = process.env.FFMPEG_PATH ?? "ffmpeg";
const SAMPLE_RATE = 8000;

/** ffmpeg output args that stream input 0 (mic) and input 1 (system) as
 *  8 kHz mono PCM to fds 3 and 4. Appended to the mix_audio invocation so
 *  the tracks are downloaded and decoded once for both jobs. */
export const ACTIVITY_OUTPUT_ARGS = [
  "-map", "0:a", "-ac", "1", "-ar", String(SAMPLE_RATE), "-f", "s16le", "pipe:3",
  "-map", "1:a", "-ac", "1", "-ar", String(SAMPLE_RATE), "-f", "s16le", "pipe:4",
];

/**
 * Runs ffmpeg with `args` (which must end with ACTIVITY_OUTPUT_ARGS) and
 * frames the two PCM pipes into loudness frames. Loudness only — no
 * audio is kept. Killed on `timeoutMs` or `signal` abort so a hung
 * decoder can't outlive its pg-boss job and overlap the retry.
 */
export function runFfmpegWithActivity(params: {
  args: string[];
  timeoutMs: number;
  signal?: AbortSignal;
  label: string;
}): Promise<ActivityFrames> {
  return new Promise((resolve, reject) => {
    if (params.signal?.aborted) {
      reject(new Error(`${params.label}: aborted before start`));
      return;
    }
    const proc = spawn(ffmpegPath, params.args, {
      stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"],
    });
    const mic = new PcmFrameAccumulator(SAMPLE_RATE, ACTIVITY_FRAME_MS);
    const system = new PcmFrameAccumulator(SAMPLE_RATE, ACTIVITY_FRAME_MS);
    const errChunks: Buffer[] = [];
    let killedFor: string | null = null;
    const kill = (why: string) => {
      if (killedFor) return;
      killedFor = why;
      proc.kill("SIGKILL");
    };
    const timer = setTimeout(() => kill(`timed out after ${params.timeoutMs} ms`), params.timeoutMs);
    const onAbort = () => kill("aborted");
    params.signal?.addEventListener("abort", onAbort, { once: true });
    const cleanup = () => {
      clearTimeout(timer);
      params.signal?.removeEventListener("abort", onAbort);
    };

    proc.stdio[3]?.on("data", (chunk: Buffer) => mic.push(chunk));
    proc.stdio[4]?.on("data", (chunk: Buffer) => system.push(chunk));
    proc.stderr?.on("data", (chunk: Buffer) => errChunks.push(chunk));
    proc.on("error", (err) => {
      cleanup();
      reject(err);
    });
    proc.on("close", (code) => {
      cleanup();
      if (killedFor) {
        reject(new Error(`${params.label}: ffmpeg ${killedFor}`));
        return;
      }
      if (code !== 0) {
        reject(
          new Error(
            `${params.label}: ffmpeg exited with ${code}: ${Buffer.concat(errChunks).toString("utf8").slice(0, 300)}`
          )
        );
        return;
      }
      resolve({ frameMs: ACTIVITY_FRAME_MS, mic: mic.finish(), system: system.finish() });
    });
  });
}

/** Activity for a note recorded before mix_audio wrote activity.bin. */
export async function computeActivityFromTrackKeys(args: {
  micKey: string;
  systemAudioKey: string;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<ActivityFrames> {
  const [micUrl, systemUrl] = await Promise.all([
    presignGet(args.micKey),
    presignGet(args.systemAudioKey),
  ]);
  return runFfmpegWithActivity({
    // One decode thread: this fallback runs inside the web container
    // next to mixing/transcoding; loudness doesn't need more.
    // -threads is per input (and per output), so it's given for both.
    args: [
      "-hide_banner", "-loglevel", "error",
      "-threads", "1", "-i", micUrl,
      "-threads", "1", "-i", systemUrl,
      ...ACTIVITY_OUTPUT_ARGS,
    ],
    timeoutMs: args.timeoutMs,
    signal: args.signal,
    label: "activity decode",
  });
}

export async function uploadActivity(key: string, frames: ActivityFrames): Promise<void> {
  await uploadBytes(key, encodeActivity(frames), "application/octet-stream");
}

/** Null when the object is missing or not a valid activity file; a
 *  network/storage error throws (the caller's job retries). */
export async function loadActivity(key: string, signal?: AbortSignal): Promise<ActivityFrames | null> {
  const res = await fetch(await presignGet(key), { signal });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`activity.bin fetch failed: HTTP ${res.status}`);
  return decodeActivity(new Uint8Array(await res.arrayBuffer()));
}
