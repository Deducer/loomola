import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { presignGet } from "@/lib/r2/presigned-get";
import { uploadFile } from "@/lib/r2/upload-bytes";
import { db } from "@/db";
import { mediaObjects } from "@/db/schema";
import { eq } from "drizzle-orm";
import { playbackKeyForComposite } from "@/lib/recordings/artifact-keys";

export const TRANSCODE_PLAYBACK_JOB = "transcode_playback";

export type TranscodePlaybackJobData = {
  mediaObjectId: string;
  compositeKey: string;
};

const ffmpegPath = process.env.FFMPEG_PATH ?? "ffmpeg";

export async function runTranscodePlaybackJob(
  data: TranscodePlaybackJobData
): Promise<void> {
  const inputUrl = await presignGet(data.compositeKey);
  const dir = await mkdtemp(join(tmpdir(), "loom-playback-"));
  const outputPath = join(dir, "playback.mp4");
  const playbackKey = playbackKeyForComposite(data.compositeKey);

  try {
    await ffmpegTranscodePlayback(inputUrl, outputPath);
    await uploadFile(playbackKey, outputPath, "video/mp4");

    await db
      .update(mediaObjects)
      .set({ playbackMp4Key: playbackKey })
      .where(eq(mediaObjects.id, data.mediaObjectId));

    console.log(`[transcode-playback] saved ${playbackKey} for ${data.mediaObjectId}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function ffmpegTranscodePlayback(inputUrl: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      inputUrl,
      "-map",
      "0:v:0",
      "-map",
      "0:a:0?",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "23",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-y",
      outputPath,
    ];
    const proc = spawn(ffmpegPath, args, { stdio: ["ignore", "ignore", "pipe"] });
    const errChunks: Buffer[] = [];
    proc.stderr.on("data", (chunk) => errChunks.push(chunk));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `ffmpeg playback transcode exited with ${code}: ${Buffer.concat(errChunks).toString("utf8")}`
          )
        );
        return;
      }
      resolve();
    });
  });
}
