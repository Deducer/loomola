import { describe, expect, it } from "vitest";
import {
  mixedAudioKeyForTrack,
  recordingPrefixFromTrackKey,
  sourceTranscriptAudioKeyForTrack,
  waveformKeyForTrack,
} from "@/lib/recording/audio-artifacts";

describe("audio artifact keys", () => {
  it("resolves the recording prefix from raw audio tracks", () => {
    expect(recordingPrefixFromTrackKey("abc123/raw/mic.m4a")).toBe("abc123");
    expect(recordingPrefixFromTrackKey("abc123/raw/system-audio.webm")).toBe(
      "abc123"
    );
  });

  it("resolves the recording prefix from generated artifacts", () => {
    expect(recordingPrefixFromTrackKey("abc123/mixed.m4a")).toBe("abc123");
  });

  it("builds stable mixed audio and waveform keys", () => {
    expect(mixedAudioKeyForTrack("abc123/raw/mic.m4a")).toBe(
      "abc123/mixed.m4a"
    );
    expect(waveformKeyForTrack("abc123/mixed.m4a")).toBe("abc123/waveform.png");
  });

  it("builds a stable source-aware transcript audio key", () => {
    expect(sourceTranscriptAudioKeyForTrack("abc123/raw/mic.m4a")).toBe(
      "abc123/transcript-channels.m4a"
    );
  });
});
