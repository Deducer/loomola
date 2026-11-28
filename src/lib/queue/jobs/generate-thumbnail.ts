import { spawn } from "node:child_process";
import { presignGet } from "@/lib/r2/presigned-get";
import { uploadBytes } from "@/lib/r2/upload-bytes";
import { db } from "@/db";
import { mediaObjects } from "@/db/schema";
import { eq } from "drizzle-orm";
import { flipToReadyIfComplete } from "@/db/queries/ai-outputs";
import { thumbnailKeyForComposite } from "@/lib/recordings/artifact-keys";
import { parseFrameRate } from "@/lib/review/frames";

export const THUMBNAIL_JOB = "generate_thumbnail";

export type ThumbnailJobData = { mediaObjectId: string; compositeKey: string };

// System ffmpeg: apk-installed in the container (musl-native, correct DNS).
// Local dev needs `brew install ffmpeg` (or similar). Override via FFMPEG_PATH.
const ffmpegPath = process.env.FFMPEG_PATH ?? "ffmpeg";
const ffprobePath = process.env.FFPROBE_PATH ?? "ffprobe";

/**
 * Extracts a JPG frame at the 1-second mark from the composite video using
 * ffmpeg reading directly from a signed R2 URL (HTTP range requests only —
 * no full download). Uploads the JPG to R2 and records the key on the
 * media_objects row.
 */
export async function runThumbnailJob(data: ThumbnailJobData): Promise<void> {
  const videoUrl = await presignGet(data.compositeKey);

  const [jpg, fps] = await Promise.all([
    ffmpegExtractFrame(videoUrl, 1.0),
    // Frame rate for frame-accurate review timecodes. Best-effort: a probe
    // failure must never cost the thumbnail.
    probeFps(videoUrl).catch((err) => {
      console.warn(`[thumbnail] fps probe failed for ${data.mediaObjectId}:`, err);
      return null;
    }),
  ]);
  const thumbKey = thumbnailKeyForComposite(data.compositeKey);

  await uploadBytes(thumbKey, jpg, "image/jpeg");

  await db
    .update(mediaObjects)
    .set({
      compositeThumbnailKey: thumbKey,
      ...(fps != null ? { fps: String(fps) } : {}),
    })
    .where(eq(mediaObjects.id, data.mediaObjectId));

  await flipToReadyIfComplete(data.mediaObjectId);

  console.log(
    `[thumbnail] saved ${thumbKey} (${jpg.byteLength} bytes) for ${data.mediaObjectId}`
  );
}

/**
 * Invokes ffmpeg to seek to `seekSec` in the remote URL and return a single
 * JPG-encoded frame as a Buffer. Uses -ss before -i for fast seek.
 */
function ffmpegExtractFrame(url: string, seekSec: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const args = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      String(seekSec),
      "-i",
      url,
      "-frames:v",
      "1",
      "-q:v",
      "5",
      "-f",
      "image2pipe",
      "-vcodec",
      "mjpeg",
      "pipe:1",
    ];
    const proc = spawn(ffmpegPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    proc.stdout.on("data", (c) => chunks.push(c));
    proc.stderr.on("data", (c) => errChunks.push(c));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `ffmpeg exited with ${code}: ${Buffer.concat(errChunks).toString("utf8")}`
          )
        );
        return;
      }
      resolve(new Uint8Array(Buffer.concat(chunks)));
    });
  });
}

/** avg_frame_rate of the first video stream (falls back to r_frame_rate);
 *  null when neither is plausible (see sanitizeFps). */
function probeFps(url: string): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const args = [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=avg_frame_rate,r_frame_rate",
      "-of",
      "json",
      url,
    ];
    const proc = spawn(ffprobePath, args, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    proc.stdout.on("data", (c) => chunks.push(c));
    proc.on("error", reject);
    const timer = setTimeout(() => proc.kill("SIGKILL"), 60_000);
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`ffprobe exited with ${code}`));
        return;
      }
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
          streams?: Array<{ avg_frame_rate?: string; r_frame_rate?: string }>;
        };
        const stream = parsed.streams?.[0];
        resolve(parseFrameRate(stream?.avg_frame_rate) ?? parseFrameRate(stream?.r_frame_rate));
      } catch (err) {
        reject(err);
      }
    });
  });
}
