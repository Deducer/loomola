import { describe, expect, it } from "vitest";
import { noteAudioSegments, planNoteAudioJobs, resumeTracksFor } from "@/lib/notes/audio-pipeline";
import { ffmpegMixArgs, ffmpegMixGraph, mixSegmentsFromJobData } from "@/lib/queue/jobs/mix-audio";
import { keyForTrack } from "@/lib/recording/upload-keys";
import { recordingPrefixFromTrackKey } from "@/lib/recording/audio-artifacts";

const twoTrack = {
  r2MicKey: "abc/raw/mic.m4a",
  r2SystemaudioKey: "abc/raw/system-audio.m4a",
  r2MixedKey: "abc/mixed.m4a",
  audioSegments: null,
};

describe("planNoteAudioJobs", () => {
  it("mixes a two-track single-segment note", () => {
    expect(planNoteAudioJobs(twoTrack)).toEqual({
      kind: "mix",
      segments: [{ micKey: twoTrack.r2MicKey, systemAudioKey: twoTrack.r2SystemaudioKey }],
    });
  });

  it("sends a mic-only single-segment note straight to transcription", () => {
    expect(
      planNoteAudioJobs({
        r2MicKey: "abc/raw/mic.m4a",
        r2SystemaudioKey: null,
        r2MixedKey: "abc/raw/mic.m4a",
        audioSegments: null,
      })
    ).toEqual({ kind: "transcribe", audioKey: "abc/raw/mic.m4a" });
  });

  it("falls back to the mixed key when the raw columns are empty", () => {
    expect(
      planNoteAudioJobs({ r2MicKey: null, r2SystemaudioKey: null, r2MixedKey: "abc/mixed.m4a", audioSegments: null })
    ).toEqual({ kind: "transcribe", audioKey: "abc/mixed.m4a" });
  });

  it("mixes once a Resume segment exists, even for a single-track note", () => {
    const plan = planNoteAudioJobs({
      r2MicKey: "abc/raw/mic.m4a",
      r2SystemaudioKey: null,
      r2MixedKey: "abc/raw/mic.m4a",
      audioSegments: [
        { micKey: "abc/raw/mic-seg2.m4a", systemAudioKey: null, durationSeconds: 30, recordedAt: "2026-11-05T10:00:00Z" },
      ],
    });
    expect(plan.kind).toBe("mix");
    expect(noteAudioSegments(twoTrack)).toHaveLength(1);
  });

  it("reports no plan when the note has no audio at all", () => {
    expect(planNoteAudioJobs({ r2MicKey: null, r2SystemaudioKey: null, r2MixedKey: null, audioSegments: null })).toEqual({ kind: "none" });
  });
});

describe("mixSegmentsFromJobData", () => {
  it("reads the legacy single-segment job shape", () => {
    expect(mixSegmentsFromJobData({ mediaObjectId: "m", micKey: "a", systemAudioKey: "b" })).toEqual([
      { micKey: "a", systemAudioKey: "b" },
    ]);
  });
});

describe("ffmpegMixGraph", () => {
  it("keeps the single-segment graph identical to the legacy args", () => {
    const legacy = ffmpegMixArgs({ micUrl: "m1", systemUrl: "s1", outputPath: "out.m4a" });
    const graph = ffmpegMixGraph({ segments: [{ micUrl: "m1", systemUrl: "s1" }], outputPath: "out.m4a" });
    expect(graph.args).toEqual(legacy);
    expect(graph.hasActivity).toBe(true);
    expect(legacy).toContain("-map");
    expect(legacy.join(" ")).toContain("-map 0:a -ac 1");
    expect(legacy.join(" ")).toContain("-map 1:a -ac 1");
  });

  it("concatenates each track across segments and taps activity off the joined tracks", () => {
    const graph = ffmpegMixGraph({
      segments: [
        { micUrl: "m1", systemUrl: "s1" },
        { micUrl: "m2", systemUrl: "s2" },
      ],
      outputPath: "out.m4a",
    });
    const filter = graph.args[graph.args.indexOf("-filter_complex") + 1];
    expect(graph.args.filter((a) => a === "-i")).toHaveLength(4);
    expect(filter).toContain("[m0][m1]concat=n=2:v=0:a=1[micfull]");
    expect(filter).toContain("[s0][s1]concat=n=2:v=0:a=1[sysfull]");
    expect(filter).toContain("sidechaincompress");
    expect(filter).toContain("loudnorm=I=-16");
    expect(graph.args.join(" ")).toContain("-map [micact] -ac 1");
    expect(graph.args.join(" ")).toContain("-map [sysact] -ac 1");
    expect(graph.hasActivity).toBe(true);
  });

  it("substitutes silence of the segment's own length for a missing track", () => {
    const graph = ffmpegMixGraph({
      segments: [
        { micUrl: "m1", systemUrl: "s1" },
        { micUrl: "m2", systemUrl: null },
      ],
      outputPath: "out.m4a",
    });
    const filter = graph.args[graph.args.indexOf("-filter_complex") + 1];
    expect(graph.args.filter((a) => a === "-i")).toHaveLength(3);
    expect(filter).toContain("[2:a]aformat=channel_layouts=mono,volume=0[s1]");
  });

  it("just joins and normalises a note that only ever had one track", () => {
    const graph = ffmpegMixGraph({
      segments: [
        { micUrl: "m1", systemUrl: null },
        { micUrl: "m2", systemUrl: null },
      ],
      outputPath: "out.m4a",
    });
    const filter = graph.args[graph.args.indexOf("-filter_complex") + 1];
    expect(filter).toContain("concat=n=2:v=0:a=1,loudnorm=I=-16");
    expect(filter).not.toContain("sidechaincompress");
    expect(graph.hasActivity).toBe(false);
    expect(graph.args).not.toContain("pipe:3");
  });
});

describe("resumeTracksFor", () => {
  it("mirrors segment 1's track set", () => {
    expect(resumeTracksFor(twoTrack)).toEqual(["mic", "system-audio"]);
    expect(resumeTracksFor({ r2MicKey: null, r2SystemaudioKey: "s", r2MixedKey: "s" })).toEqual(["system-audio"]);
    expect(resumeTracksFor({ r2MicKey: null, r2SystemaudioKey: null, r2MixedKey: "m" })).toEqual(["mic"]);
    expect(resumeTracksFor({ r2MicKey: null, r2SystemaudioKey: null, r2MixedKey: null })).toEqual([]);
  });
});

describe("keyForTrack segments", () => {
  it("keeps segment 1 keys unchanged and numbers later segments under raw/", () => {
    expect(keyForTrack("abc", "mic", "audio/mp4")).toBe("abc/raw/mic.m4a");
    expect(keyForTrack("abc", "mic", "audio/mp4", 1)).toBe("abc/raw/mic.m4a");
    const seg2 = keyForTrack("abc", "system-audio", "audio/mp4", 2);
    expect(seg2).toBe("abc/raw/system-audio-seg2.m4a");
    expect(recordingPrefixFromTrackKey(seg2)).toBe("abc");
  });
});
