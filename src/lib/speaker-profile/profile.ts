import type { WordTimestamp } from "@/db/queries/transcripts";
import type { ActivityFrames } from "./activity";

/**
 * Per-diarized-voice capture evidence for one transcript (speaker
 * recognition v2). Loomola records the mic and system audio as separate
 * tracks; the voice whose speech lines up with "mic loud, system quiet"
 * is the recorder — Granola's Me/Them signal, recovered after the batch
 * transcript's diarization has re-numbered everyone.
 *
 * Thresholds come from a 2026-10-27 probe of 50 production notes: where
 * the recorder was audible, their voice was 43–94% mic-only and every
 * other voice 0–13% (one outlier at 17%).
 */

/** "merged": mic-dominant speech AND substantial system audio in one
 *  diarized voice — the recorder and a remote speaker merged together. */
export type SpeakerSource = "mic" | "system" | "mixed" | "merged" | "unknown";

/**
 * - live_channels: a live transcript — indices ARE capture channels
 *   (0 = mic, 1 = everyone on system audio).
 * - capture: batch transcript with usable mic/system evidence.
 * - mic_unusable: tracks exist but no voice is mic-dominant (dead,
 *   truncated or silent mic, or the recorder never spoke).
 * - in_person: almost no system audio during speech — everyone is on
 *   the mic, so the mic can't single out the recorder.
 * - ambiguous: more than two mic-dominant voices (someone else in the
 *   room with the recorder).
 * - no_tracks: the note has no capture tracks at all (web recordings,
 *   imports) — the only case where talk-time guessing is allowed.
 * A note with only ONE of the two tracks is mic_unusable, not no_tracks.
 */
export type CaptureStatus =
  | "live_channels"
  | "capture"
  | "mic_unusable"
  | "in_person"
  | "ambiguous"
  | "no_tracks";

export type SpeakerProfileEntry = {
  speakerIdx: number;
  speechSec: number;
  share: number;
  /** Too little speech to count as a participant (diarization splinter). */
  fragment: boolean;
  source: SpeakerSource;
  micOnlyShare: number | null;
  systemShare: number | null;
  /** Identified as the recorder only by the low-gain rule (15% mic-only
   *  with every other voice near 0) — weaker evidence, so suggested
   *  rather than applied. */
  lowGain?: boolean;
};

export type SpeakerProfile = {
  version: 1;
  status: CaptureStatus;
  /** mic track length ÷ system track length, capped at 1. */
  micCoverage: number | null;
  entries: SpeakerProfileEntry[];
  /** Stage-17 LLM pass for this transcript, set by the worker: "pending"
   *  while it runs (so a crash leaves the note unfinished for the
   *  backfill), then "done" / "failed" / "skipped" (nothing to ask). */
  llm?: "pending" | "skipped" | "done" | "failed";
  /** Which worker run wrote this profile; only that run may record its
   *  LLM outcome (an obsolete run must not mark a newer one complete). */
  runId?: string;
};

export const FRAGMENT_MIN_SEC = 10;
export const FRAGMENT_MIN_SHARE = 0.02;
const ACTIVE_ABOVE_FLOOR_DB = 15;
const ACTIVE_CAP_DB = -35;
const MIC_ONLY_STRONG = 0.4;
const MIC_ONLY_WEAK = 0.15;
const OTHERS_MAX_FOR_WEAK = 0.03;
const SYSTEM_DOMINANT = 0.7;
/** The recorder's own voice sat at 2–14% system activity across the
 *  50-note probe; more than this means remote speech is in the cluster. */
const MIC_VOICE_SYSTEM_MAX = 0.25;
const IN_PERSON_SYSTEM_MAX = 0.1;

function percentile(values: number[], q: number): number {
  if (values.length === 0) return -120;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(q * (sorted.length - 1))];
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function computeSpeakerProfile(args: {
  words: ReadonlyArray<WordTimestamp>;
  provider: string | null;
  activity: ActivityFrames | null;
  /** Whether the note has its capture tracks. Defaults to "both" when
   *  activity is given, "none" otherwise. */
  tracks?: "both" | "partial" | "none";
}): SpeakerProfile {
  const speech = new Map<number, number>();
  for (const w of args.words) {
    if (typeof w.speaker !== "number") continue;
    const dur = w.end - w.start;
    if (!(dur > 0)) continue;
    speech.set(w.speaker, (speech.get(w.speaker) ?? 0) + dur);
  }
  const total = Array.from(speech.values()).reduce((a, b) => a + b, 0) || 1;
  const base = Array.from(speech.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([speakerIdx, sec]) => ({
      speakerIdx,
      speechSec: round3(sec),
      share: round3(sec / total),
      fragment: sec < FRAGMENT_MIN_SEC || sec / total < FRAGMENT_MIN_SHARE,
    }));

  if (args.provider === "deepgram-live") {
    return {
      version: 1,
      status: "live_channels",
      micCoverage: null,
      entries: base.map((e) => ({
        ...e,
        source: e.speakerIdx === 0 ? "mic" : e.speakerIdx === 1 ? "system" : "unknown",
        micOnlyShare: null,
        systemShare: null,
      })),
    };
  }

  const activity = args.activity;
  const tracks = args.tracks ?? (activity ? "both" : "none");
  if (!activity || activity.system.length === 0) {
    return {
      version: 1,
      // One track present (or frames unreadable) is NOT "no tracks": the
      // mic would have answered, so no talk-time fallback either.
      status: tracks === "none" && !activity ? "no_tracks" : "mic_unusable",
      micCoverage: null,
      entries: base.map((e) => ({ ...e, source: "unknown", micOnlyShare: null, systemShare: null })),
    };
  }

  const frameSec = activity.frameMs / 1000;
  // "Active" = 15 dB over the track's own noise floor, capped so a track
  // that is loud throughout (continuous bleed or noise lifts the 10th
  // percentile) still registers ordinary speech levels.
  const micOnThreshold = Math.min(percentile(activity.mic, 0.1) + ACTIVE_ABOVE_FLOOR_DB, ACTIVE_CAP_DB);
  const sysOnThreshold = Math.min(percentile(activity.system, 0.1) + ACTIVE_ABOVE_FLOOR_DB, ACTIVE_CAP_DB);
  const micOn = (f: number) => f < activity.mic.length && activity.mic[f] > micOnThreshold;
  const sysOn = (f: number) => f < activity.system.length && activity.system[f] > sysOnThreshold;

  const counts = new Map<number, { frames: number; micOnly: number; sys: number }>();
  let speechFrames = 0;
  let speechSysFrames = 0;
  for (const w of args.words) {
    if (typeof w.speaker !== "number" || !(w.end > w.start)) continue;
    const c = counts.get(w.speaker) ?? { frames: 0, micOnly: 0, sys: 0 };
    for (let f = Math.floor(w.start / frameSec); f <= Math.floor(w.end / frameSec); f++) {
      const s = sysOn(f);
      c.frames++;
      if (s) c.sys++;
      else if (micOn(f)) c.micOnly++;
      speechFrames++;
      if (s) speechSysFrames++;
    }
    counts.set(w.speaker, c);
  }

  const measured = base.map((e) => {
    const c = counts.get(e.speakerIdx);
    const micOnlyShare = c && c.frames > 0 ? round3(c.micOnly / c.frames) : 0;
    const systemShare = c && c.frames > 0 ? round3(c.sys / c.frames) : 0;
    return { ...e, micOnlyShare, systemShare };
  });
  const micCoverage = round3(Math.min(1, activity.mic.length / activity.system.length));

  if (speechFrames > 0 && speechSysFrames / speechFrames < IN_PERSON_SYSTEM_MAX) {
    return {
      version: 1,
      status: "in_person",
      micCoverage,
      entries: measured.map((e) => ({ ...e, source: "unknown" })),
    };
  }

  const participants = measured.filter((e) => !e.fragment);
  // Mic-dominant voices; those that ALSO carry substantial system audio
  // are the recorder merged with a remote speaker by diarization, and
  // can't be named "Me" (or "them") on loudness alone.
  const micDominant = new Set(
    participants.filter((e) => e.micOnlyShare >= MIC_ONLY_STRONG).map((e) => e.speakerIdx)
  );
  let lowGainIdx: number | null = null;
  if (micDominant.size === 0) {
    // Low-gain mic: one voice clearly ahead while every other voice is
    // essentially never mic-only.
    const ranked = [...participants].sort((a, b) => b.micOnlyShare - a.micOnlyShare);
    const top = ranked[0];
    if (
      top &&
      top.micOnlyShare >= MIC_ONLY_WEAK &&
      ranked.slice(1).every((e) => e.micOnlyShare <= OTHERS_MAX_FOR_WEAK)
    ) {
      micDominant.add(top.speakerIdx);
      lowGainIdx = top.speakerIdx;
    }
  }
  const systemShareOf = new Map(measured.map((e) => [e.speakerIdx, e.systemShare]));
  const strong = new Set([...micDominant].filter((i) => (systemShareOf.get(i) ?? 1) <= MIC_VOICE_SYSTEM_MAX));
  const merged = new Set([...micDominant].filter((i) => !strong.has(i)));

  const entries: SpeakerProfileEntry[] = measured.map((e) => ({
    ...e,
    ...(e.speakerIdx === lowGainIdx ? { lowGain: true } : {}),
    source: strong.has(e.speakerIdx)
      ? "mic"
      : merged.has(e.speakerIdx)
        ? "merged"
        : e.systemShare >= SYSTEM_DOMINANT
          ? "system"
          : "mixed",
  }));

  const status: CaptureStatus =
    strong.size === 0 ? "mic_unusable" : strong.size > 2 ? "ambiguous" : "capture";
  return { version: 1, status, micCoverage, entries };
}

/** Voices the capture evidence says are the recorder ("Me"). */
export function meSpeakerIdxs(profile: SpeakerProfile): number[] {
  if (profile.status === "live_channels") {
    return profile.entries.some((e) => e.speakerIdx === 0 && e.speechSec > 0) ? [0] : [];
  }
  if (profile.status !== "capture") return [];
  return profile.entries.filter((e) => e.source === "mic" && !e.fragment).map((e) => e.speakerIdx);
}

/** Participant voices that are not the recorder. Empty unless the
 *  recorder was found, since otherwise "remote" can't be separated. */
export function remoteSpeakerIdxs(profile: SpeakerProfile): number[] {
  const me = new Set(meSpeakerIdxs(profile));
  if (me.size === 0) return [];
  // A voice holding both the recorder and a remote speaker means the
  // remaining voices can't be trusted as "everyone else".
  if (profile.entries.some((e) => !e.fragment && e.source === "merged")) return [];
  if (profile.status === "live_channels") {
    return profile.entries.some((e) => e.speakerIdx === 1 && e.speechSec > 0) ? [1] : [];
  }
  return profile.entries
    .filter((e) => !e.fragment && !me.has(e.speakerIdx))
    .map((e) => e.speakerIdx);
}

/** The single non-fragment voice that merges the recorder with a remote
 *  speaker, when there is exactly one — offered for review, never named. */
export function mergedMeSpeakerIdx(profile: SpeakerProfile): number | null {
  const merged = profile.entries.filter((e) => !e.fragment && e.source === "merged");
  return merged.length === 1 ? merged[0].speakerIdx : null;
}

/** Other voices may total at most this share of all speech, each under
 *  OTHER_VOICE_MAX_SEC, for a call to count as having ONE remote voice. */
const OTHER_VOICES_MAX_SHARE = 0.03;
const OTHER_VOICE_MAX_SEC = 30;

/**
 * The remote voice of a genuine 1:1, or null. Stricter than "one
 * non-fragment remote voice": the fragment cutoff (10 s / 2%) could hide
 * a real but quiet third participant, so every other non-recorder voice
 * must be under 30 s and all of them together under 3% of the speech.
 * Live transcripts: the call-audio channel, when the recorder was found.
 */
export function soleRemoteSpeakerIdx(profile: SpeakerProfile): number | null {
  const remote = remoteSpeakerIdxs(profile);
  if (remote.length !== 1) return null;
  if (profile.status === "live_channels") return remote[0];
  const me = new Set(meSpeakerIdxs(profile));
  const total = profile.entries.reduce((a, e) => a + e.speechSec, 0) || 1;
  const others = profile.entries.filter((e) => !me.has(e.speakerIdx) && e.speakerIdx !== remote[0]);
  const othersSec = others.reduce((a, e) => a + e.speechSec, 0);
  if (others.some((e) => e.speechSec >= OTHER_VOICE_MAX_SEC)) return null;
  if (othersSec / total >= OTHER_VOICES_MAX_SHARE) return null;
  return remote[0];
}

