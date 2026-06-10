import { describe, expect, it } from "vitest";
import {
  isTranscribeProvider,
  normalizedTranscribeProvider,
  resolveTranscribeProvider,
} from "@/lib/transcription/provider";
import {
  OPENAI_TRANSCRIBE_MAX_BYTES,
  classifyWhisperHttpFailure,
  whisperOversizeReason,
} from "@/lib/transcription/whisper-errors";

describe("normalizedTranscribeProvider", () => {
  it("defaults unset and empty to deepgram", () => {
    expect(normalizedTranscribeProvider(undefined)).toBe("deepgram");
    expect(normalizedTranscribeProvider("")).toBe("deepgram");
    expect(normalizedTranscribeProvider("  ")).toBe("deepgram");
  });
  it("trims and passes through explicit values verbatim", () => {
    expect(normalizedTranscribeProvider(" openai-whisper ")).toBe("openai-whisper");
    expect(normalizedTranscribeProvider("whisper")).toBe("whisper");
  });
});

describe("resolveTranscribeProvider", () => {
  it("accepts both known providers", () => {
    expect(resolveTranscribeProvider("deepgram")).toBe("deepgram");
    expect(resolveTranscribeProvider("openai-whisper")).toBe("openai-whisper");
    expect(resolveTranscribeProvider(undefined)).toBe("deepgram");
  });
  it("throws a readable error on unknown values", () => {
    expect(() => resolveTranscribeProvider("whisper")).toThrow(
      /Unknown TRANSCRIBE_PROVIDER "whisper".*deepgram.*openai-whisper/
    );
  });
  it("isTranscribeProvider narrows", () => {
    expect(isTranscribeProvider("deepgram")).toBe(true);
    expect(isTranscribeProvider("openai-whisper")).toBe(true);
    expect(isTranscribeProvider("assemblyai")).toBe(false);
  });
});

describe("whisper failure classification", () => {
  it("treats auth failures as terminal with an API-key reason", () => {
    for (const status of [401, 403]) {
      const v = classifyWhisperHttpFailure(status, "{}");
      expect(v.terminal).toBe(true);
      if (v.terminal) expect(v.reason).toMatch(/OPENAI_API_KEY/);
    }
  });
  it("treats quota exhaustion as terminal", () => {
    const v = classifyWhisperHttpFailure(
      429,
      '{"error":{"code":"insufficient_quota","message":"You exceeded your current quota"}}'
    );
    expect(v.terminal).toBe(true);
    if (v.terminal) expect(v.reason).toMatch(/out of credits/);
  });
  it("treats plain 429 rate limits and 5xx as retryable", () => {
    expect(classifyWhisperHttpFailure(429, '{"error":{"code":"rate_limit_exceeded"}}').terminal).toBe(false);
    expect(classifyWhisperHttpFailure(500, "oops").terminal).toBe(false);
    expect(classifyWhisperHttpFailure(503, "").terminal).toBe(false);
  });
  it("treats 400 and 413 as terminal", () => {
    expect(classifyWhisperHttpFailure(400, "bad file").terminal).toBe(true);
    const v = classifyWhisperHttpFailure(413, "");
    expect(v.terminal).toBe(true);
    if (v.terminal) expect(v.reason).toMatch(/deepgram/i);
  });
  it("oversize reason names the size, the limit, and the deepgram escape hatch", () => {
    const reason = whisperOversizeReason(30 * 1024 * 1024);
    expect(reason).toMatch(/30\.0MB/);
    expect(reason).toMatch(/25MB/);
    expect(reason).toMatch(/TRANSCRIBE_PROVIDER=deepgram/);
    expect(OPENAI_TRANSCRIBE_MAX_BYTES).toBe(25 * 1024 * 1024);
  });
});
