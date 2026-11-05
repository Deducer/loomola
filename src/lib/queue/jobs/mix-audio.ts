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
  ACTIVITY_OUTPUT_ARGS,
  activityOutputArgs,
  runFfmpegWithActivity,
  uploadActivity,
} from "@/lib/speaker-profile/track-activity";
import type { ActivityFrames } from "@/lib/speaker-profile/activity";

export const MIX_AUDIO_JOB = "mix_audio";

/** One recorded stretch of a note. A track a segment never captured is
 *  null; the graph substitutes silence of that segment's length. */
export type MixSegment = {
  micKey: string | null;
  systemAudioKey: string | null;
};

export type MixAudioJobData = {
  mediaObjectId: string;
  /** Legacy single-segment shape, still produced by queued jobs. */
  micKey?: string;
  systemAudioKey?: string;
  /** Resume after Stop: every segment in recording order. */
  segments?: MixSegment[];
};

export function mixSegmentsFromJobData(data: MixAudioJobData): MixSegment[] {
  if (data.segments && data.segments.length > 0) return data.segments;
  return [
    {
      micKey: data.micKey ?? null,
      systemAudioKey: data.systemAudioKey ?? null,
    },
  ];
}

// The stereo transcript-channels.m4a (mic-L/system-R) this job used to
// produce alongside the mono mix was removed 2026-07-02: Deepgram bills
// multichannel per channel, so transcribing it doubled every meeting's
// billed minutes, and diarization (free) on the mono mix separates
// multi-party meetings better than the binary mic/system split. It also
// duplicated a full-length audio file per note in R2.
export async function runMixAudioJob(
  data: MixAudioJobData,
  opts: { signal?: AbortSignal } = {}
): Promise<{
  mixedKey: string;
}> {
  const segments = mixSegmentsFromJobData(data);
  const firstKey = segments
    .flatMap((segment) => [segment.micKey, segment.systemAudioKey])
    .find((key): key is string => Boolean(key));
  if (!firstKey) throw new Error(`[mix-audio] no audio keys for ${data.mediaObjectId}`);

  const presigned = await Promise.all(
    segments.map(async (segment) => ({
      micUrl: segment.micKey ? await presignGet(segment.micKey) : null,
      systemUrl: segment.systemAudioKey ? await presignGet(segment.systemAudioKey) : null,
    }))
  );
  const dir = await mkdtemp(join(tmpdir(), "loom-audio-mix-"));
  const outputPath = join(dir, "mixed.m4a");
  const mixedKey = mixedAudioKeyForTrack(firstKey);
  const graph = ffmpegMixGraph({ segments: presigned, outputPath });

  try {
    const frames = await runFfmpegWithActivity({
      args: graph.args,
      timeoutMs: MIX_TIMEOUT_MS,
      signal: opts.signal,
      label: "audio mix",
    });
    await uploadFile(mixedKey, outputPath, "audio/mp4");

    await db
      .update(mediaObjects)
      .set({ r2MixedKey: mixedKey })
      .where(eq(mediaObjects.id, data.mediaObjectId));

    console.log(
      `[mix-audio] saved ${mixedKey} for ${data.mediaObjectId} (${segments.length} segment(s))`
    );
    if (graph.hasActivity) await saveActivityFrames(data.mediaObjectId, firstKey, frames);
    return { mixedKey };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// Speaker recognition v2: mic/system loudness frames, the evidence that
// identifies "Me" among the batch transcript's diarized voices. They come
// out of the SAME ffmpeg pass as the mix (two extra PCM pipes), so the
// tracks are downloaded and decoded once. Written before transcription is
// enqueued; an upload failure never fails the mix — suggest_speakers then
// decodes the tracks itself.
async function saveActivityFrames(
  mediaObjectId: string,
  trackKey: string,
  frames: ActivityFrames
): Promise<void> {
  try {
    const activityKey = activityKeyForTrack(trackKey);
    await uploadActivity(activityKey, frames);
    await db
      .update(mediaObjects)
      .set({ r2ActivityKey: activityKey })
      .where(eq(mediaObjects.id, mediaObjectId));
  } catch (err) {
    console.error(`[mix-audio] activity frames failed for ${mediaObjectId}:`, err);
  }
}

// The mix had no time limit before; a hung ffmpeg now dies well inside the
// job's 3600 s expiry instead of overlapping pg-boss's retry. Decoding runs
// far faster than real time, so this only fires on a genuine hang.
const MIX_TIMEOUT_MS = 45 * 60 * 1000;

export type MixGraphSegment = {
  micUrl: string | null;
  systemUrl: string | null;
};

/** Legacy single-segment entry point (tests and docs). */
export function ffmpegMixArgs(params: {
  micUrl: string;
  systemUrl: string;
  outputPath: string;
}): string[] {
  return ffmpegMixGraph({
    segments: [{ micUrl: params.micUrl, systemUrl: params.systemUrl }],
    outputPath: params.outputPath,
  }).args;
}

const LOUDNORM = "loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000";

const DUCK_MIX_LOUDNORM = [
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
  "[system]asplit=2[sc][sysmix]",
  "[mic][sc]sidechaincompress=threshold=0.004:ratio=20:attack=3:release=400:level_sc=2[micducked]",
  // Then normalise loudness. A webcam mic across the room (2026-11-04,
  // Opal C1 as the default input) gave a -37 LUFS mic track; amix's
  // normalize=1 took another 6 dB off and Deepgram's batch pass returned
  // ZERO words for 5.6 minutes of speech, while the same audio brought to
  // -16 LUFS transcribed at 0.94 confidence. loudnorm's single-pass mode
  // is a dynamic normaliser, so a normal-level call is barely touched.
  // It resamples to 192 kHz internally; aresample puts the mix back at
  // 48 kHz so the file stays small and transcript timings line up with
  // the raw-track activity frames.
  `[micducked][sysmix]amix=inputs=2:duration=longest:normalize=1,${LOUDNORM}[out]`,
];

/**
 * Builds the single ffmpeg pass for a note's audio.
 *
 * One segment with both tracks is the graph the app has always run
 * (inputs 0/1 feed the activity pipes directly). Resume after Stop adds
 * segments: each segment's mic tracks are concatenated, likewise the
 * system tracks, and the usual duck + mix + loudnorm runs on the joined
 * tracks, with the activity pipes tapped off the joined tracks so "Me"
 * evidence covers the whole note. A segment missing one track gets
 * silence of exactly its own length (its other track at volume 0), so
 * timings stay aligned. A note with only one track throughout is just
 * concatenated and normalised; it has no mic/system evidence.
 */
export function ffmpegMixGraph(params: {
  segments: MixGraphSegment[];
  outputPath: string;
}): { args: string[]; hasActivity: boolean } {
  const segments = params.segments;
  if (segments.length === 0) throw new Error("ffmpegMixGraph: no segments");
  const inputs: string[] = [];
  const indexOf = (url: string | null): number | null => {
    if (!url) return null;
    inputs.push(url);
    return inputs.length - 1;
  };
  const placed = segments.map((segment) => ({
    mic: indexOf(segment.micUrl),
    system: indexOf(segment.systemUrl),
  }));
  if (placed.some((p) => p.mic == null && p.system == null)) {
    throw new Error("ffmpegMixGraph: a segment has no audio track");
  }
  const twoTrack = placed.some((p) => p.mic != null && p.system != null);
  const inputArgs = inputs.flatMap((url) => ["-i", url]);
  const outputArgs = [
    "-map", "[out]", "-c:a", "aac", "-b:a", "128k", "-y", params.outputPath,
  ];
  const common = ["-hide_banner", "-loglevel", "error", ...inputArgs];

  if (!twoTrack) {
    // Mic-only or system-only all the way through.
    const labels = placed.map((p, i) => {
      const idx = p.mic ?? p.system;
      return { filter: `[${idx}:a]aformat=channel_layouts=mono[t${i}]`, label: `[t${i}]` };
    });
    const joined =
      labels.length === 1
        ? `${labels[0].label}${LOUDNORM}[out]`
        : `${labels.map((l) => l.label).join("")}concat=n=${labels.length}:v=0:a=1,${LOUDNORM}[out]`;
    const filter = [...labels.map((l) => l.filter), joined].join(";");
    return {
      args: [...common, "-filter_complex", filter, ...outputArgs],
      hasActivity: false,
    };
  }

  if (segments.length === 1) {
    const filter = [
      "[0:a]aformat=channel_layouts=mono[mic]",
      "[1:a]aformat=channel_layouts=mono[system]",
      ...DUCK_MIX_LOUDNORM,
    ].join(";");
    return {
      args: [...common, "-filter_complex", filter, ...outputArgs, ...ACTIVITY_OUTPUT_ARGS],
      hasActivity: true,
    };
  }

  const perSegment = placed.flatMap((p, i) => {
    // Silence of the segment's own length when it lacks a track.
    const mic =
      p.mic != null
        ? `[${p.mic}:a]aformat=channel_layouts=mono[m${i}]`
        : `[${p.system}:a]aformat=channel_layouts=mono,volume=0[m${i}]`;
    const system =
      p.system != null
        ? `[${p.system}:a]aformat=channel_layouts=mono[s${i}]`
        : `[${p.mic}:a]aformat=channel_layouts=mono,volume=0[s${i}]`;
    return [mic, system];
  });
  const n = placed.length;
  const micConcat = `${placed.map((_, i) => `[m${i}]`).join("")}concat=n=${n}:v=0:a=1[micfull]`;
  const systemConcat = `${placed.map((_, i) => `[s${i}]`).join("")}concat=n=${n}:v=0:a=1[sysfull]`;
  const filter = [
    ...perSegment,
    micConcat,
    systemConcat,
    "[micfull]asplit=2[mic][micact]",
    "[sysfull]asplit=2[system][sysact]",
    ...DUCK_MIX_LOUDNORM,
  ].join(";");
  return {
    args: [
      ...common,
      "-filter_complex",
      filter,
      ...outputArgs,
      ...activityOutputArgs("[micact]", "[sysact]"),
    ],
    hasActivity: true,
  };
}
