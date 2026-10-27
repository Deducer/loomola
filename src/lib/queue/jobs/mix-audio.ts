import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { db } from "@/db";
import { mediaObjects } from "@/db/schema";
import { eq } from "drizzle-orm";
import { presignGet } from "@/lib/r2/presigned-get";
import { uploadFile } from "@/lib/r2/upload-bytes";
import {
  activityKeyForTrack,
  mixedAudioKeyForTrack,
} from "@/lib/recording/audio-artifacts";
import {
  computeActivityFromTrackKeys,
  uploadActivity,
} from "@/lib/speaker-profile/track-activity";

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
    await saveActivityFrames(data);
    return { mixedKey };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// Speaker recognition v2: mic/system loudness frames, the evidence that
// identifies "Me" among the batch transcript's diarized voices. Written
// before transcription is enqueued so suggest_speakers finds it. Never
// fails the mix — without frames the worker just can't use the mic.
async function saveActivityFrames(data: MixAudioJobData): Promise<void> {
  try {
    const frames = await computeActivityFromTrackKeys({
      micKey: data.micKey,
      systemAudioKey: data.systemAudioKey,
    });
    const activityKey = activityKeyForTrack(data.micKey);
    await uploadActivity(activityKey, frames);
    await db
      .update(mediaObjects)
      .set({ r2ActivityKey: activityKey })
      .where(eq(mediaObjects.id, data.mediaObjectId));
  } catch (err) {
    console.error(`[mix-audio] activity frames failed for ${data.mediaObjectId}:`, err);
  }
}

function ffmpegMixToMono(params: {
  micUrl: string;
  systemUrl: string;
  outputPath: string;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    // Sidechain-duck the mic under system audio before mixing. When the
    // user is on speakers, the mic re-captures the remote participants
    // ~10-50ms late; a plain amix feeds Deepgram both copies and the
    // transcript stutters ("that that that") AND drops words. Measured on
    // a real contaminated call (2026-07-07, two 3-min segments, nova-2 +
    // diarize): plain amix = 7.0-11.4% doubled words, 290-359 words
    // recognized; this duck = 2.6-3.3% doubled (the natural-speech floor,
    // matching a system-only reference) with 487-502 words recognized.
    // The mic still carries the user's voice whenever the remote side is
    // quiet; simultaneous crosstalk ducks the user, which is the same
    // trade every AEC makes. Headphone users' mic has no bleed, so the
    // duck almost never engages.
    const filter = [
      "[0:a]aformat=channel_layouts=mono[mic]",
      "[1:a]aformat=channel_layouts=mono[system]",
      "[system]asplit=2[sc][sysmix]",
      "[mic][sc]sidechaincompress=threshold=0.004:ratio=20:attack=3:release=400:level_sc=2[micducked]",
      "[micducked][sysmix]amix=inputs=2:duration=longest:normalize=1[out]",
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

