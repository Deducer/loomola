import { createHash, randomBytes } from "node:crypto";

export function generateInviteToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("hex");
  return { token, tokenHash: hashInviteToken(token) };
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type InviteValidation =
  | { ok: true }
  | { ok: false; reason: "not_found" | "expired" | "already_accepted" };

export function validateInvite(
  invite: { expiresAt: Date; acceptedAt: Date | null } | null,
  now: Date
): InviteValidation {
  if (!invite) return { ok: false, reason: "not_found" };
  if (invite.acceptedAt) return { ok: false, reason: "already_accepted" };
  if (invite.expiresAt.getTime() <= now.getTime())
    return { ok: false, reason: "expired" };
  return { ok: true };
}
