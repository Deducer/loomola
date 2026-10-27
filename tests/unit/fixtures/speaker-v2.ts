// Synthetic speaker-v2 fixtures: word timestamps and mic/system loudness
// frames built from time ranges. No real transcript text (public repo).
import type { WordTimestamp } from "@/db/queries/transcripts";
import type { ActivityFrames } from "@/lib/speaker-profile/activity";

export type Turn = { speaker: number; from: number; to: number };

/** One 1-second word per second of each turn. */
export function wordsFor(turns: Turn[]): WordTimestamp[] {
  const words: WordTimestamp[] = [];
  for (const t of turns) {
    for (let s = t.from; s < t.to; s++) {
      words.push({ word: "x", start: s, end: Math.min(s + 0.9, t.to), speaker: t.speaker });
    }
  }
  return words.sort((a, b) => a.start - b.start);
}

/**
 * Frames at 100 ms. `micOn` / `systemOn` are [from, to) second ranges
 * where that track is loud (-20 dB); elsewhere it sits at a -70 dB
 * noise floor. `micSeconds` truncates the mic track (a mic that died).
 */
export function framesFor(args: {
  durationSec: number;
  micOn: Array<[number, number]>;
  systemOn: Array<[number, number]>;
  micSeconds?: number;
  silentMic?: boolean;
}): ActivityFrames {
  const n = Math.round(args.durationSec * 10);
  const inRange = (sec: number, ranges: Array<[number, number]>) =>
    ranges.some(([a, b]) => sec >= a && sec < b);
  const micN = Math.round((args.micSeconds ?? args.durationSec) * 10);
  const mic: number[] = [];
  const system: number[] = [];
  for (let f = 0; f < n; f++) {
    const sec = f / 10;
    if (f < micN) mic.push(args.silentMic ? -120 : inRange(sec, args.micOn) ? -20 : -70);
    system.push(inRange(sec, args.systemOn) ? -20 : -70);
  }
  return { frameMs: 100, mic, system };
}

/** Turns → mic loud while a mic speaker talks, system loud while any
 *  remote speaker talks. `bleed` also makes the mic loud during remote
 *  turns (laptop speakers). */
export function framesForTurns(
  turns: Turn[],
  micSpeakers: number[],
  opts: { bleed?: boolean; micSeconds?: number; silentMic?: boolean } = {}
): ActivityFrames {
  const duration = Math.max(...turns.map((t) => t.to));
  const mine = turns.filter((t) => micSpeakers.includes(t.speaker)).map((t) => [t.from, t.to] as [number, number]);
  const theirs = turns.filter((t) => !micSpeakers.includes(t.speaker)).map((t) => [t.from, t.to] as [number, number]);
  return framesFor({
    durationSec: duration,
    micOn: opts.bleed ? [...mine, ...theirs] : mine,
    systemOn: theirs,
    micSeconds: opts.micSeconds,
    silentMic: opts.silentMic,
  });
}

/** Alternating turns: `pattern` is a list of [speaker, seconds]. */
export function turns(pattern: Array<[number, number]>): Turn[] {
  const out: Turn[] = [];
  let t = 0;
  for (const [speaker, dur] of pattern) {
    out.push({ speaker, from: t, to: t + dur });
    t += dur;
  }
  return out;
}
