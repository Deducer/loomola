import { describe, expect, it } from "vitest";
import { decideRetryStage } from "@/lib/recordings/retry-plan";

const NO_KEYS = {
  r2MixedKey: null,
  r2CompositeKey: null,
  r2MicKey: null,
  r2SystemaudioKey: null,
};

describe("decideRetryStage", () => {
  it("video without transcript → re-transcribe from the composite", () => {
    expect(
      decideRetryStage({
        type: "video",
        hasTranscript: false,
        ...NO_KEYS,
        r2CompositeKey: "media/abc/composite.webm",
      })
    ).toEqual({
      kind: "transcribe",
      sourceKey: "media/abc/composite.webm",
      isAudioSource: false,
    });
  });

  it("audio without transcript → re-transcribe; mixed key wins over mic", () => {
    expect(
      decideRetryStage({
        type: "audio",
        hasTranscript: false,
        ...NO_KEYS,
        r2MixedKey: "media/abc/mixed.m4a",
        r2MicKey: "media/abc/mic.m4a",
      })
    ).toEqual({
      kind: "transcribe",
      sourceKey: "media/abc/mixed.m4a",
      isAudioSource: true,
    });
  });

  it("no transcript and no uploaded media → unrecoverable", () => {
    const result = decideRetryStage({
      type: "video",
      hasTranscript: false,
      ...NO_KEYS,
    });
    expect(result.kind).toBe("unrecoverable");
  });

  it("video with transcript → re-run AI jobs", () => {
    expect(
      decideRetryStage({
        type: "video",
        hasTranscript: true,
        ...NO_KEYS,
        r2CompositeKey: "media/abc/composite.webm",
      })
    ).toEqual({ kind: "ai" });
  });

  it("audio with transcript → flip to ready (webhook parity)", () => {
    expect(
      decideRetryStage({
        type: "audio",
        hasTranscript: true,
        ...NO_KEYS,
        r2MixedKey: "media/abc/mixed.m4a",
      })
    ).toEqual({ kind: "audio-ready" });
  });
});
