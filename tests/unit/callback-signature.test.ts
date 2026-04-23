import { describe, it, expect, beforeAll } from "vitest";
import {
  signRecordingId,
  verifyRecordingSignature,
} from "@/lib/deepgram/callback-signature";

beforeAll(() => {
  process.env.DEEPGRAM_CALLBACK_SIGNING_SECRET =
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
});

describe("signRecordingId", () => {
  it("produces a 64-char hex string", () => {
    const sig = signRecordingId("00000000-0000-0000-0000-000000000001");
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic", () => {
    const a = signRecordingId("abc");
    const b = signRecordingId("abc");
    expect(a).toBe(b);
  });

  it("changes when input changes", () => {
    const a = signRecordingId("abc");
    const b = signRecordingId("abd");
    expect(a).not.toBe(b);
  });
});

describe("verifyRecordingSignature", () => {
  it("accepts a freshly-signed value", () => {
    const id = "00000000-0000-0000-0000-000000000001";
    expect(verifyRecordingSignature(id, signRecordingId(id))).toBe(true);
  });

  it("rejects a tampered id", () => {
    const id = "00000000-0000-0000-0000-000000000001";
    const sig = signRecordingId(id);
    expect(verifyRecordingSignature("different-id", sig)).toBe(false);
  });

  it("rejects an empty signature", () => {
    expect(verifyRecordingSignature("any", "")).toBe(false);
  });

  it("rejects a short / malformed signature", () => {
    expect(verifyRecordingSignature("any", "zzz")).toBe(false);
  });
});
