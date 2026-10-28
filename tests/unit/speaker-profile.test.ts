import { describe, it, expect } from "vitest";
import {
  computeSpeakerProfile,
  meSpeakerIdxs,
  remoteSpeakerIdxs,
} from "@/lib/speaker-profile/profile";
import {
  decodeActivity,
  encodeActivity,
  PcmFrameAccumulator,
} from "@/lib/speaker-profile/activity";
import { framesFor, framesForTurns, turns, wordsFor } from "./fixtures/speaker-v2";

describe("activity frames", () => {
  it("round-trips through the binary format, keeping track lengths independent", () => {
    const frames = { frameMs: 100, mic: [-120, -40.4, -3], system: [-60, -10, -20, -70, -1] };
    const decoded = decodeActivity(encodeActivity(frames));
    expect(decoded).toEqual({ frameMs: 100, mic: [-120, -40, -3], system: [-60, -10, -20, -70, -1] });
  });

  it("rejects buffers that aren't activity frames", () => {
    expect(decodeActivity(Buffer.from("nope"))).toBeNull();
    const truncated = encodeActivity({ frameMs: 100, mic: [-1, -2], system: [-3] }).subarray(0, 16);
    expect(decodeActivity(truncated)).toBeNull();
  });

  it("frames PCM into RMS dB, carrying split samples across chunks", () => {
    const acc = new PcmFrameAccumulator(10, 100); // 1 sample per frame
    const pcm = Buffer.alloc(6);
    pcm.writeInt16LE(0, 0);
    pcm.writeInt16LE(16384, 2); // half scale → -6 dB
    pcm.writeInt16LE(-32768, 4); // full scale → 0 dB
    acc.push(pcm.subarray(0, 3));
    acc.push(pcm.subarray(3));
    expect(acc.finish()).toEqual([-120, -6, 0]);
  });
});

describe("computeSpeakerProfile", () => {
  // Ian (speaker 2) on the mic; two remote voices on system audio.
  const call = turns([[0, 40], [2, 20], [1, 30], [2, 15], [0, 25]]);

  it("finds the recorder from the mic track regardless of diarization order or talk time", () => {
    const profile = computeSpeakerProfile({
      words: wordsFor(call),
      provider: "deepgram",
      activity: framesForTurns(call, [2]),
    });
    expect(profile.status).toBe("capture");
    expect(meSpeakerIdxs(profile)).toEqual([2]);
    expect(remoteSpeakerIdxs(profile)).toEqual([0, 1]);
    const me = profile.entries.find((e) => e.speakerIdx === 2)!;
    expect(me.micOnlyShare).toBeGreaterThan(0.9);
    expect(profile.entries.find((e) => e.speakerIdx === 0)!.source).toBe("system");
  });

  it("survives speaker bleed: remote turns are loud on the mic too, but never mic-only", () => {
    const profile = computeSpeakerProfile({
      words: wordsFor(call),
      provider: "deepgram",
      activity: framesForTurns(call, [2], { bleed: true }),
    });
    expect(meSpeakerIdxs(profile)).toEqual([2]);
  });

  it("reports mic_unusable when the mic track is silent", () => {
    const profile = computeSpeakerProfile({
      words: wordsFor(call),
      provider: "deepgram",
      activity: framesForTurns(call, [2], { silentMic: true }),
    });
    expect(profile.status).toBe("mic_unusable");
    expect(meSpeakerIdxs(profile)).toEqual([]);
    expect(remoteSpeakerIdxs(profile)).toEqual([]);
  });

  it("reports mic_unusable and low coverage when the mic died before the recorder spoke", () => {
    const profile = computeSpeakerProfile({
      words: wordsFor(call),
      provider: "deepgram",
      activity: framesForTurns(call, [2], { micSeconds: 30 }),
    });
    expect(profile.status).toBe("mic_unusable");
    expect(profile.micCoverage).toBeCloseTo(30 / 130, 2);
  });

  it("treats a call with no system audio as in-person (the mic can't single anyone out)", () => {
    const room = turns([[0, 30], [1, 30], [2, 30]]);
    const profile = computeSpeakerProfile({
      words: wordsFor(room),
      provider: "deepgram",
      activity: framesFor({ durationSec: 90, micOn: [[0, 90]], systemOn: [] }),
    });
    expect(profile.status).toBe("in_person");
    expect(meSpeakerIdxs(profile)).toEqual([]);
  });

  it("flags more than two mic-dominant voices as ambiguous", () => {
    const shared = turns([[0, 20], [1, 20], [2, 20], [3, 40]]);
    const profile = computeSpeakerProfile({
      words: wordsFor(shared),
      provider: "deepgram",
      activity: framesForTurns(shared, [0, 1, 2]),
    });
    expect(profile.status).toBe("ambiguous");
    expect(meSpeakerIdxs(profile)).toEqual([]);
  });

  it("marks diarization splinters as fragments and keeps them out of remote voices", () => {
    const split = turns([[0, 60], [1, 60], [3, 4]]);
    const profile = computeSpeakerProfile({
      words: wordsFor(split),
      provider: "deepgram",
      activity: framesForTurns(split, [0]),
    });
    expect(profile.entries.find((e) => e.speakerIdx === 3)!.fragment).toBe(true);
    expect(remoteSpeakerIdxs(profile)).toEqual([1]);
  });

  it("accepts a low-gain mic when every other voice is essentially never mic-only", () => {
    // Recorder's mic is loud for only a fifth of their speech.
    const quiet = turns([[0, 50], [1, 50]]);
    const activity = framesFor({ durationSec: 100, micOn: [[0, 10]], systemOn: [[50, 100]] });
    const profile = computeSpeakerProfile({ words: wordsFor(quiet), provider: "deepgram", activity });
    expect(meSpeakerIdxs(profile)).toEqual([0]);
  });

  it("never calls a voice that merges the recorder with a remote speaker 'Me' (45 s local + 55 s remote)", () => {
    // Diarization put Ian (mic, 0–45 s) and a remote speaker (system,
    // 45–100 s) into ONE voice 0; voice 1 is another remote speaker.
    const words = wordsFor([
      { speaker: 0, from: 0, to: 45 },
      { speaker: 0, from: 45, to: 100 },
      { speaker: 1, from: 100, to: 160 },
    ]);
    const activity = framesFor({ durationSec: 160, micOn: [[0, 45]], systemOn: [[45, 160]] });
    const profile = computeSpeakerProfile({ words, provider: "deepgram", activity });
    const v0 = profile.entries.find((e) => e.speakerIdx === 0)!;
    expect(v0.micOnlyShare).toBeGreaterThan(0.4);
    expect(v0.source).toBe("merged");
    expect(meSpeakerIdxs(profile)).toEqual([]);
    expect(remoteSpeakerIdxs(profile)).toEqual([]);
  });

  it("treats a note with only one capture track as mic_unusable, never no_tracks", () => {
    const profile = computeSpeakerProfile({ words: wordsFor(call), provider: "deepgram", activity: null, tracks: "partial" });
    expect(profile.status).toBe("mic_unusable");
  });

  it("uses capture channels as-is for live transcripts", () => {
    const live = turns([[0, 10], [1, 60]]);
    const profile = computeSpeakerProfile({ words: wordsFor(live), provider: "deepgram-live", activity: null });
    expect(profile.status).toBe("live_channels");
    expect(meSpeakerIdxs(profile)).toEqual([0]);
    expect(remoteSpeakerIdxs(profile)).toEqual([1]);
  });

  it("reports no_tracks without activity frames", () => {
    const profile = computeSpeakerProfile({ words: wordsFor(call), provider: "deepgram", activity: null });
    expect(profile.status).toBe("no_tracks");
    expect(profile.entries.every((e) => e.source === "unknown")).toBe(true);
  });
});
