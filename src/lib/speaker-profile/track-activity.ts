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

/** Decodes one track to 8 kHz mono PCM and frames it. Loudness only —
 *  no audio is kept. */
function framesForUrl(url: string): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      ffmpegPath,
      ["-hide_banner", "-loglevel", "error", "-i", url, "-ac", "1", "-ar", String(SAMPLE_RATE), "-f", "s16le", "pipe:1"],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    const acc = new PcmFrameAccumulator(SAMPLE_RATE, ACTIVITY_FRAME_MS);
    const errChunks: Buffer[] = [];
    proc.stdout.on("data", (chunk: Buffer) => acc.push(chunk));
    proc.stderr.on("data", (chunk: Buffer) => errChunks.push(chunk));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg activity decode exited with ${code}: ${Buffer.concat(errChunks).toString("utf8").slice(0, 300)}`));
        return;
      }
      resolve(acc.finish());
    });
  });
}

export async function computeActivityFromTrackKeys(args: {
  micKey: string;
  systemAudioKey: string;
}): Promise<ActivityFrames> {
  const [micUrl, systemUrl] = await Promise.all([
    presignGet(args.micKey),
    presignGet(args.systemAudioKey),
  ]);
  const [mic, system] = await Promise.all([framesForUrl(micUrl), framesForUrl(systemUrl)]);
  return { frameMs: ACTIVITY_FRAME_MS, mic, system };
}

export async function uploadActivity(key: string, frames: ActivityFrames): Promise<void> {
  await uploadBytes(key, encodeActivity(frames), "application/octet-stream");
}

export async function loadActivity(key: string): Promise<ActivityFrames | null> {
  const res = await fetch(await presignGet(key));
  if (!res.ok) return null;
  return decodeActivity(new Uint8Array(await res.arrayBuffer()));
}
