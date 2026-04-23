import { describe, it, expect, beforeAll } from "vitest";
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

  it("produces a deterministic hex token", () => {
    const t1 = signUnlockToken({ slug, passwordHash });
    const t2 = signUnlockToken({ slug, passwordHash });
    expect(t1).toBe(t2);
    expect(t1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("accepts its own output", () => {
    const token = signUnlockToken({ slug, passwordHash });
    expect(verifyUnlockToken({ slug, passwordHash, token })).toBe(true);
  });

  it("rejects a tampered token", () => {
    const token = signUnlockToken({ slug, passwordHash });
    const bad = "0".repeat(token.length);
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
});
