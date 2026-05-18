import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { db } from "@/db";
import { aiOutputs, mediaObjects, transcripts } from "@/db/schema";
import {
  appendClipBlockReason,
  getAppendClipSource,
  getAppendClipTarget,
} from "@/db/queries/recording-clips";
import { presignGet } from "@/lib/r2/presigned-get";
import { uploadFile } from "@/lib/r2/upload-bytes";
import { compositeEditKey } from "@/lib/recordings/artifact-keys";
import { and, eq, sql } from "drizzle-orm";

export const APPEND_CLIP_JOB = "append_clip";

export type AppendClipJobData = {
  targetId: string;
  clipId: string;
  ownerId: string;
};

export type AppendClipJobResult = {
  mediaObjectId: string;
  compositeKey: string;
  durationSeconds: number;
};

type ProbeInfo = {
  width: number;
  height: number;
  durationSec: number | null;
  hasAudio: boolean;
};

const ffmpegPath = process.env.FFMPEG_PATH ?? "ffmpeg";
const ffprobePath = process.env.FFPROBE_PATH ?? "ffprobe";

export async function runAppendClipJob(
  data: AppendClipJobData
): Promise<AppendClipJobResult> {
  const target = await getAppendClipTarget({
    ownerId: data.ownerId,
    targetId: data.targetId,
  });
  const clip = await getAppendClipSource({
    ownerId: data.ownerId,
    reference: { kind: "id", value: data.clipId },
  });

  try {
    if (!target || target.status !== "processing") {
      throw new Error("target_not_processing");
    }
    const targetReason = appendClipBlockReason({
      ...target,
      status: "ready",
    });
    const clipReason = appendClipBlockReason(clip);
    if (targetReason) throw new Error(`target_${targetReason}`);
    if (clipReason) throw new Error(`clip_${clipReason}`);
    if (!clip || clip.id === target.id) throw new Error("clip_not_appendable");

    const targetCompositeKey = target.r2CompositeKey!;
    const clipCompositeKey = clip.r2CompositeKey!;
    const targetDurationSec = Number(target.durationSeconds);
    const clipDurationSec = Number(clip.durationSeconds);
    const durationSeconds = targetDurationSec + clipDurationSec;

    const [targetUrl, clipUrl] = await Promise.all([
      presignGet(targetCompositeKey),
      presignGet(clipCompositeKey),
    ]);
    const [targetProbe, clipProbe] = await Promise.all([
      ffprobe(targetUrl),
      ffprobe(clipUrl),
    ]);

    const outputKey = compositeEditKey(targetCompositeKey);
    const dir = await mkdtemp(join(tmpdir(), "loom-append-"));
    const outputPath = join(dir, "composite.mp4");

    try {
      await ffmpegConcatTwo({
        firstUrl: targetUrl,
        secondUrl: clipUrl,
        firstDurationSec: targetProbe.durationSec ?? targetDurationSec,
        secondDurationSec: clipProbe.durationSec ?? clipDurationSec,
        firstHasAudio: targetProbe.hasAudio,
        secondHasAudio: clipProbe.hasAudio,
        width: targetProbe.width,
        height: targetProbe.height,
        outputPath,
      });
      await uploadFile(outputKey, outputPath, "video/mp4");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }

    await db.transaction(async (tx) => {
      await tx.delete(transcripts).where(eq(transcripts.mediaObjectId, target.id));
      await tx.delete(aiOutputs).where(eq(aiOutputs.mediaObjectId, target.id));
      await tx
        .update(mediaObjects)
        .set({
          r2CompositeKey: outputKey,
          playbackMp4Key: null,
          compositeThumbnailKey: null,
          previewSpriteKey: null,
          trimStartSec: null,
          trimEndSec: null,
          durationSeconds: String(durationSeconds),
          status: "transcribing",
          updatedAt: sql`now()`,
        })
        .where(
          and(eq(mediaObjects.id, target.id), eq(mediaObjects.ownerId, data.ownerId))
        );
    });

    console.log(
      `[append-clip] appended ${clip.id} to ${target.id}; saved ${outputKey}`
    );

    return {
      mediaObjectId: target.id,
      compositeKey: outputKey,
      durationSeconds,
    };
  } catch (err) {
    await restoreTargetReady(data.targetId, data.ownerId);
    throw err;
  }
}

async function restoreTargetReady(targetId: string, ownerId: string): Promise<void> {
  await db
    .update(mediaObjects)
    .set({ status: "ready", updatedAt: sql`now()` })
    .where(and(eq(mediaObjects.id, targetId), eq(mediaObjects.ownerId, ownerId)));
}

async function ffprobe(url: string): Promise<ProbeInfo> {
  return new Promise((resolve, reject) => {
    const args = [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      url,
    ];
    const proc = spawn(ffprobePath, args, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    proc.stdout.on("data", (chunk) => chunks.push(chunk));
    proc.stderr.on("data", (chunk) => errChunks.push(chunk));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `ffprobe exited with ${code}: ${Buffer.concat(errChunks).toString("utf8")}`
          )
        );
        return;
      }
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
          format?: { duration?: string };
          streams?: Array<{
            codec_type?: string;
            width?: number;
            height?: number;
            duration?: string;
          }>;
        };
        const video = parsed.streams?.find((stream) => stream.codec_type === "video");
        if (!video?.width || !video?.height) {
          reject(new Error("ffprobe_no_video_stream"));
          return;
        }
        const duration =
          Number(parsed.format?.duration ?? video.duration ?? Number.NaN);
        resolve({
          width: evenDimension(video.width),
          height: evenDimension(video.height),
          durationSec: Number.isFinite(duration) ? duration : null,
          hasAudio:
            parsed.streams?.some((stream) => stream.codec_type === "audio") ?? false,
        });
      } catch (err) {
        reject(err);
      }
    });
  });
}

function ffmpegConcatTwo(params: {
  firstUrl: string;
  secondUrl: string;
  firstDurationSec: number;
  secondDurationSec: number;
  firstHasAudio: boolean;
  secondHasAudio: boolean;
  width: number;
  height: number;
  outputPath: string;
}): Promise<void> {
  const video0 = videoFilter("0", "v0", params.width, params.height);
  const video1 = videoFilter("1", "v1", params.width, params.height);
  const audio0 = audioFilter("0", "a0", params.firstHasAudio, params.firstDurationSec);
  const audio1 = audioFilter("1", "a1", params.secondHasAudio, params.secondDurationSec);
  const filter = `${video0};${video1};${audio0};${audio1};[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]`;

  return new Promise((resolve, reject) => {
    const args = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      params.firstUrl,
      "-i",
      params.secondUrl,
      "-filter_complex",
      filter,
      "-map",
      "[v]",
      "-map",
      "[a]",
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
      params.outputPath,
    ];
    const proc = spawn(ffmpegPath, args, { stdio: ["ignore", "ignore", "pipe"] });
    const errChunks: Buffer[] = [];
    proc.stderr.on("data", (chunk) => errChunks.push(chunk));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `ffmpeg append exited with ${code}: ${Buffer.concat(errChunks).toString("utf8")}`
          )
        );
        return;
      }
      resolve();
    });
  });
}

function videoFilter(
  inputIndex: string,
  output: string,
  width: number,
  height: number
): string {
  return `[${inputIndex}:v:0]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=30,format=yuv420p[${output}]`;
}

function audioFilter(
  inputIndex: string,
  output: string,
  hasAudio: boolean,
  durationSec: number
): string {
  if (hasAudio) {
    return `[${inputIndex}:a:0]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,asetpts=PTS-STARTPTS[${output}]`;
  }
  return `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=0:${Math.max(
    0.1,
    durationSec
  )},asetpts=PTS-STARTPTS[${output}]`;
}

function evenDimension(value: number): number {
  const rounded = Math.max(2, Math.round(value));
  return rounded % 2 === 0 ? rounded : rounded - 1;
}
