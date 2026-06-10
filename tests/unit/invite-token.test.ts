import { describe, expect, it } from "vitest";
import {
  generateInviteToken,
  hashInviteToken,
  validateInvite,
} from "@/lib/invites/token";

describe("invite tokens", () => {
  it("generates a 64-hex-char token whose hash matches hashInviteToken", () => {
    const { token, tokenHash } = generateInviteToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(hashInviteToken(token)).toBe(tokenHash);
    expect(tokenHash).not.toBe(token);
  });

  it("two generations never collide", () => {
    expect(generateInviteToken().token).not.toBe(generateInviteToken().token);
  });
});

describe("validateInvite", () => {
  const now = new Date("2026-06-10T12:00:00Z");
  const future = new Date("2026-06-11T12:00:00Z");
  const past = new Date("2026-06-09T12:00:00Z");

  it("rejects null (not found)", () => {
    expect(validateInvite(null, now)).toEqual({ ok: false, reason: "not_found" });
  });

  it("rejects expired", () => {
    expect(validateInvite({ expiresAt: past, acceptedAt: null }, now)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("rejects already accepted", () => {
    expect(
      validateInvite({ expiresAt: future, acceptedAt: past }, now)
    ).toEqual({ ok: false, reason: "already_accepted" });
  });

  it("accepts a live invite", () => {
    expect(
      validateInvite({ expiresAt: future, acceptedAt: null }, now)
    ).toEqual({ ok: true });
  });
});
