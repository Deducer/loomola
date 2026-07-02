import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { db } from "@/db";
import { mediaObjects } from "@/db/schema";
import { eq } from "drizzle-orm";
import { presignGet } from "@/lib/r2/presigned-get";
import { uploadFile } from "@/lib/r2/upload-bytes";
import { mixedAudioKeyForTrack } from "@/lib/recording/audio-artifacts";

export const MIX_AUDIO_JOB = "mix_audio";

export type MixAudioJobData = {
  mediaObjectId: string;
  micKey: string;
  systemAudioKey: string;
};

const ffmpegPath = process.env.FFMPEG_PATH ?? "ffmpeg";

// The stereo transcript-channels.m4a (mic-L/system-R) this job used to
// produce alongside the mono mix was removed 2026-07-02: Deepgram bills
// multichannel per channel, so transcribing it doubled every meeting's
// billed minutes, and diarization (free) on the mono mix separates
// multi-party meetings better than the binary mic/system split. It also
// duplicated a full-length audio file per note in R2.
export async function runMixAudioJob(data: MixAudioJobData): Promise<{
  mixedKey: string;
}> {
  const micUrl = await presignGet(data.micKey);
  const systemUrl = await presignGet(data.systemAudioKey);
  const dir = await mkdtemp(join(tmpdir(), "loom-audio-mix-"));
  const outputPath = join(dir, "mixed.m4a");
  const mixedKey = mixedAudioKeyForTrack(data.micKey);

  try {
    await ffmpegMixToMono({ micUrl, systemUrl, outputPath });
    await uploadFile(mixedKey, outputPath, "audio/mp4");

    await db
      .update(mediaObjects)
      .set({ r2MixedKey: mixedKey })
      .where(eq(mediaObjects.id, data.mediaObjectId));

    console.log(`[mix-audio] saved ${mixedKey} for ${data.mediaObjectId}`);
    return { mixedKey };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function ffmpegMixToMono(params: {
  micUrl: string;
  systemUrl: string;
  outputPath: string;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const filter = [
      "[0:a]aformat=channel_layouts=mono[mic]",
      "[1:a]aformat=channel_layouts=mono[system]",
      "[mic][system]amix=inputs=2:duration=longest:normalize=1[out]",
    ].join(";");
    const args = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      params.micUrl,
      "-i",
      params.systemUrl,
      "-filter_complex",
      filter,
      "-map",
      "[out]",
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
            `ffmpeg audio mix exited with ${code}: ${Buffer.concat(errChunks).toString("utf8")}`
          )
        );
        return;
      }
      resolve();
    });
  });
}

