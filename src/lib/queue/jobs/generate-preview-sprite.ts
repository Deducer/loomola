import { spawn } from "node:child_process";
import { presignGet } from "@/lib/r2/presigned-get";
import { uploadBytes } from "@/lib/r2/upload-bytes";
import { db } from "@/db";
import { mediaObjects } from "@/db/schema";
import { eq } from "drizzle-orm";
import { previewSpriteKeyForComposite } from "@/lib/recordings/artifact-keys";

export const PREVIEW_SPRITE_JOB = "generate_preview_sprite";

export type PreviewSpriteJobData = {
  mediaObjectId: string;
  compositeKey: string;
};

const ffmpegPath = process.env.FFMPEG_PATH ?? "ffmpeg";

export const SPRITE_TILE_WIDTH = 160;
export const SPRITE_TILE_HEIGHT = 90;
export const SPRITE_COLS = 5;
const TARGET_TILE_COUNT = 50; // upper bound — interval scales to keep sprites bounded

/**
 * Returns the interval (seconds) between successive sprite frames for a
 * video of the given duration. Uses {@link TARGET_TILE_COUNT} as a soft cap
 * so a 1-hour recording doesn't generate thousands of thumbnails.
 */
export function spriteIntervalSec(durationSec: number): number {
  if (!isFinite(durationSec) || durationSec <= 0) return 0;
  return Math.max(2, Math.round(durationSec / TARGET_TILE_COUNT));
}

/**
 * Returns the sprite-tile layout for a video duration. Used both by the
 * generator and by the VTT-serving endpoint so they agree on cell positions.
 */
export function spriteLayout(durationSec: number): {
  intervalSec: number;
  count: number;
  cols: number;
  rows: number;
  tileWidth: number;
  tileHeight: number;
} {
  const intervalSec = spriteIntervalSec(durationSec);
  if (intervalSec <= 0) {
    return {
      intervalSec: 0,
      count: 0,
      cols: SPRITE_COLS,
      rows: 0,
      tileWidth: SPRITE_TILE_WIDTH,
      tileHeight: SPRITE_TILE_HEIGHT,
    };
  }
  const count = Math.max(1, Math.ceil(durationSec / intervalSec));
  const cols = Math.min(SPRITE_COLS, count);
  const rows = Math.ceil(count / cols);
  return {
    intervalSec,
    count,
    cols,
    rows,
    tileWidth: SPRITE_TILE_WIDTH,
    tileHeight: SPRITE_TILE_HEIGHT,
  };
}

export async function runPreviewSpriteJob(data: PreviewSpriteJobData): Promise<void> {
  // Read duration off the row — recorded by /complete after upload.
  const [row] = await db
    .select({ durationSeconds: mediaObjects.durationSeconds })
    .from(mediaObjects)
    .where(eq(mediaObjects.id, data.mediaObjectId))
    .limit(1);

  const durationSec = parseFloat(String(row?.durationSeconds ?? "0"));
  if (!isFinite(durationSec) || durationSec < 10) {
    console.log(
      `[preview-sprite] skipped ${data.mediaObjectId}: duration ${durationSec}s under 10s threshold`
    );
    return;
  }

  const layout = spriteLayout(durationSec);
  if (layout.count === 0) {
    console.log(`[preview-sprite] skipped ${data.mediaObjectId}: empty layout`);
    return;
  }

  const videoUrl = await presignGet(data.compositeKey);
  const jpg = await ffmpegBuildSprite(videoUrl, layout);

  const spriteKey = previewSpriteKeyForComposite(data.compositeKey);
  await uploadBytes(spriteKey, jpg, "image/jpeg");

  await db
    .update(mediaObjects)
    .set({ previewSpriteKey: spriteKey })
    .where(eq(mediaObjects.id, data.mediaObjectId));

  console.log(
    `[preview-sprite] saved ${spriteKey} (${jpg.byteLength} bytes, ${layout.count} tiles ${layout.cols}x${layout.rows}) for ${data.mediaObjectId}`
  );
}

function ffmpegBuildSprite(
  url: string,
  layout: ReturnType<typeof spriteLayout>
): Promise<Uint8Array> {
  const fps = `1/${layout.intervalSec}`;
  const filter = `fps=${fps},scale=${layout.tileWidth}:${layout.tileHeight}:force_original_aspect_ratio=decrease,pad=${layout.tileWidth}:${layout.tileHeight}:(ow-iw)/2:(oh-ih)/2:black,tile=${layout.cols}x${layout.rows}`;

  return new Promise((resolve, reject) => {
    const args = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      url,
      "-vf",
      filter,
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
            `ffmpeg sprite exited with ${code}: ${Buffer.concat(errChunks).toString("utf8")}`
          )
        );
        return;
      }
      resolve(new Uint8Array(Buffer.concat(chunks)));
    });
  });
}
