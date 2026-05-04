import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import {
  signUnlockToken,
  verifyUnlockToken,
  cookieName,
} from "@/lib/viewer/unlock-cookie";

beforeAll(() => {
  process.env.VIEW_UNLOCK_SECRET = "a".repeat(64);
});

describe("cookieName", () => {
  it("prefixes with view_unlock_", () => {
    expect(cookieName("abc123")).toBe("view_unlock_abc123");
  });
});

describe("signUnlockToken / verifyUnlockToken", () => {
  const slug = "V2LyopYmWS";
  const passwordHash = "$2a$10$abcdefghijklmnopqrstuv";

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-04T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("produces a token shaped like <issuedAt>.<hex sig>", () => {
    const t = signUnlockToken({ slug, passwordHash });
    expect(t).toMatch(/^\d+\.[0-9a-f]{64}$/);
  });

  it("accepts its own output", () => {
    const token = signUnlockToken({ slug, passwordHash });
    expect(verifyUnlockToken({ slug, passwordHash, token })).toBe(true);
  });

  it("rejects a tampered signature", () => {
    const token = signUnlockToken({ slug, passwordHash });
    const [issuedAt, sig] = token.split(".");
    const bad = `${issuedAt}.${"0".repeat(sig.length)}`;
    expect(verifyUnlockToken({ slug, passwordHash, token: bad })).toBe(false);
  });

  it("rejects a tampered issuedAt", () => {
    const token = signUnlockToken({ slug, passwordHash });
    const [, sig] = token.split(".");
    const bad = `${Date.now() - 1000}.${sig}`;
    expect(verifyUnlockToken({ slug, passwordHash, token: bad })).toBe(false);
  });

  it("rejects the token after password hash changes", () => {
    const token = signUnlockToken({ slug, passwordHash });
    const newHash = "$2a$10$differentdifferentdifferentdif";
    expect(
      verifyUnlockToken({ slug, passwordHash: newHash, token })
    ).toBe(false);
  });

  it("returns false when passwordHash is null (no password set)", () => {
    const token = signUnlockToken({ slug, passwordHash });
    expect(
      verifyUnlockToken({ slug, passwordHash: null, token })
    ).toBe(false);
  });

  it("returns false on empty token", () => {
    expect(verifyUnlockToken({ slug, passwordHash, token: "" })).toBe(false);
  });

  it("returns false on a malformed token (no period separator)", () => {
    expect(
      verifyUnlockToken({
        slug,
        passwordHash,
        token: "a".repeat(64),
      })
    ).toBe(false);
  });

  it("rejects a token issued > 24h ago", () => {
    const token = signUnlockToken({ slug, passwordHash });
    // Advance past 24h boundary
    vi.advanceTimersByTime(24 * 60 * 60 * 1000 + 1000);
    expect(verifyUnlockToken({ slug, passwordHash, token })).toBe(false);
  });

  it("accepts a token issued just under 24h ago", () => {
    const token = signUnlockToken({ slug, passwordHash });
    vi.advanceTimersByTime(24 * 60 * 60 * 1000 - 1000);
    expect(verifyUnlockToken({ slug, passwordHash, token })).toBe(true);
  });

  it("rejects a token with a future issuedAt (clock skew defense)", () => {
    const sig = signUnlockToken({ slug, passwordHash });
    // Roll back system time so the existing token is "from the future"
    vi.setSystemTime(new Date("2026-05-03T12:00:00Z"));
    expect(verifyUnlockToken({ slug, passwordHash, token: sig })).toBe(false);
  });
});
