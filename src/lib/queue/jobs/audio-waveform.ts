import { spawn } from "node:child_process";
import { presignGet } from "@/lib/r2/presigned-get";
import { uploadBytes } from "@/lib/r2/upload-bytes";
import { db } from "@/db";
import { mediaObjects } from "@/db/schema";
import { eq } from "drizzle-orm";
import { waveformKeyForTrack } from "@/lib/recording/audio-artifacts";

export const AUDIO_WAVEFORM_JOB = "audio_waveform";

export type AudioWaveformJobData = {
  mediaObjectId: string;
  audioKey: string;
};

const ffmpegPath = process.env.FFMPEG_PATH ?? "ffmpeg";

export async function runAudioWaveformJob(
  data: AudioWaveformJobData
): Promise<void> {
  const audioUrl = await presignGet(data.audioKey);
  const png = await ffmpegWaveformPng(audioUrl);
  const waveformKey = waveformKeyForTrack(data.audioKey);

  await uploadBytes(waveformKey, png, "image/png");

  await db
    .update(mediaObjects)
    .set({ compositeThumbnailKey: waveformKey })
    .where(eq(mediaObjects.id, data.mediaObjectId));

  console.log(
    `[audio-waveform] saved ${waveformKey} (${png.byteLength} bytes) for ${data.mediaObjectId}`
  );
}

function ffmpegWaveformPng(url: string): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const args = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      url,
      "-filter_complex",
      "aformat=channel_layouts=mono,showwavespic=s=1280x240:colors=4ade80",
      "-frames:v",
      "1",
      "-f",
      "image2pipe",
      "-vcodec",
      "png",
      "pipe:1",
    ];
    const proc = spawn(ffmpegPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    proc.stdout.on("data", (chunk) => chunks.push(chunk));
    proc.stderr.on("data", (chunk) => errChunks.push(chunk));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `ffmpeg waveform exited with ${code}: ${Buffer.concat(errChunks).toString("utf8")}`
          )
        );
        return;
      }
      resolve(new Uint8Array(Buffer.concat(chunks)));
    });
  });
}
