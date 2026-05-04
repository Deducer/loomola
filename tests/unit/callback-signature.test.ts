import { describe, it, expect, beforeAll } from "vitest";
import {
  signNonce,
  verifyNonceSignature,
  issueDeepgramCallbackToken,
  verifyAndConsumeCallbackToken,
  createInMemoryNonceStore,
} from "@/lib/deepgram/callback-signature";

beforeAll(() => {
  process.env.DEEPGRAM_CALLBACK_SIGNING_SECRET =
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
});

describe("signNonce / verifyNonceSignature (pure HMAC layer)", () => {
  it("produces a 64-char hex string", () => {
    const sig = signNonce(
      "00000000-0000-0000-0000-000000000001",
      "abcd1234"
    );
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic", () => {
    expect(signNonce("rec-1", "n-1")).toBe(signNonce("rec-1", "n-1"));
  });

  it("changes when recording id changes", () => {
    expect(signNonce("rec-1", "n-1")).not.toBe(signNonce("rec-2", "n-1"));
  });

  it("changes when nonce changes", () => {
    expect(signNonce("rec-1", "n-1")).not.toBe(signNonce("rec-1", "n-2"));
  });

  it("verifies a freshly-signed token", () => {
    const sig = signNonce("rec-1", "n-1");
    expect(verifyNonceSignature("rec-1", "n-1", sig)).toBe(true);
  });

  it("rejects a tampered recordingId", () => {
    const sig = signNonce("rec-1", "n-1");
    expect(verifyNonceSignature("rec-2", "n-1", sig)).toBe(false);
  });

  it("rejects a tampered nonce", () => {
    const sig = signNonce("rec-1", "n-1");
    expect(verifyNonceSignature("rec-1", "n-2", sig)).toBe(false);
  });

  it("rejects an empty signature", () => {
    expect(verifyNonceSignature("rec-1", "n-1", "")).toBe(false);
  });

  it("rejects a malformed signature", () => {
    expect(verifyNonceSignature("rec-1", "n-1", "zzz")).toBe(false);
  });
});

describe("issueDeepgramCallbackToken / verifyAndConsumeCallbackToken", () => {
  const NOW = new Date("2026-05-04T12:00:00Z").getTime();

  it("issues a 64-char nonce and a valid signature", async () => {
    const store = createInMemoryNonceStore();
    const { nonce, sig } = await issueDeepgramCallbackToken({
      recordingId: "rec-1",
      now: NOW,
      store,
    });
    expect(nonce).toMatch(/^[0-9a-f]{64}$/);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it("verifies the issued token exactly once (replay rejected)", async () => {
    const store = createInMemoryNonceStore();
    const { nonce, sig } = await issueDeepgramCallbackToken({
      recordingId: "rec-1",
      now: NOW,
      store,
    });

    const first = await verifyAndConsumeCallbackToken({
      recordingId: "rec-1",
      nonce,
      sig,
      now: NOW + 1000,
      store,
    });
    expect(first).toBe(true);

    const second = await verifyAndConsumeCallbackToken({
      recordingId: "rec-1",
      nonce,
      sig,
      now: NOW + 2000,
      store,
    });
    expect(second).toBe(false);
  });

  it("rejects a token with a tampered signature", async () => {
    const store = createInMemoryNonceStore();
    const { nonce } = await issueDeepgramCallbackToken({
      recordingId: "rec-1",
      now: NOW,
      store,
    });
    const ok = await verifyAndConsumeCallbackToken({
      recordingId: "rec-1",
      nonce,
      sig: "0".repeat(64),
      now: NOW + 1000,
      store,
    });
    expect(ok).toBe(false);
  });

  it("rejects a token bound to a different recording id", async () => {
    const store = createInMemoryNonceStore();
    const { nonce, sig } = await issueDeepgramCallbackToken({
      recordingId: "rec-1",
      now: NOW,
      store,
    });
    const ok = await verifyAndConsumeCallbackToken({
      recordingId: "rec-2",
      nonce,
      sig,
      now: NOW + 1000,
      store,
    });
    expect(ok).toBe(false);
  });

  it("rejects an expired token (past TTL)", async () => {
    const store = createInMemoryNonceStore();
    const ttlMs = 24 * 60 * 60 * 1000;
    const { nonce, sig } = await issueDeepgramCallbackToken({
      recordingId: "rec-1",
      now: NOW,
      ttlMs,
      store,
    });
    const ok = await verifyAndConsumeCallbackToken({
      recordingId: "rec-1",
      nonce,
      sig,
      now: NOW + ttlMs + 1000,
      store,
    });
    expect(ok).toBe(false);
  });

  it("rejects a never-issued nonce (no row in store)", async () => {
    const store = createInMemoryNonceStore();
    const fakeNonce = "f".repeat(64);
    const sig = signNonce("rec-1", fakeNonce);
    const ok = await verifyAndConsumeCallbackToken({
      recordingId: "rec-1",
      nonce: fakeNonce,
      sig,
      now: NOW,
      store,
    });
    expect(ok).toBe(false);
  });
});

