import { createHmac, timingSafeEqual } from "node:crypto";

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

function getSecret(): string {
  const s = process.env.VIEW_UNLOCK_SECRET;
  if (!s) throw new Error("VIEW_UNLOCK_SECRET is not set");
  return s;
}

export function cookieName(slug: string): string {
  return `view_unlock_${slug}`;
}

function signPayload(slug: string, passwordHash: string, issuedAt: number): string {
  return createHmac("sha256", getSecret())
    .update(`${slug}:${passwordHash}:${issuedAt}`)
    .digest("hex");
}

/**
 * Sign a `<issuedAt>.<hex>` token binding the slug, current password hash,
 * and issuance timestamp. The password hash is part of the signature so that
 * changing the password implicitly invalidates outstanding tokens; the
 * issuedAt is part of the signature so an attacker who learns a token cannot
 * extend its lifetime by editing the timestamp.
 */
export function signUnlockToken({
  slug,
  passwordHash,
}: {
  slug: string;
  passwordHash: string;
}): string {
  const issuedAt = Date.now();
  const sig = signPayload(slug, passwordHash, issuedAt);
  return `${issuedAt}.${sig}`;
}

/**
 * Constant-time HMAC compare with a 24-hour expiry window. Returns false on
 * any of: missing password (no current password set), malformed token,
 * tampered signature, expired token, or future-dated token (clock skew).
 */
export function verifyUnlockToken({
  slug,
  passwordHash,
  token,
}: {
  slug: string;
  passwordHash: string | null;
  token: string;
}): boolean {
  if (!passwordHash || !token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return false;
  const issuedAtStr = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!/^\d+$/.test(issuedAtStr)) return false;
  const issuedAt = Number(issuedAtStr);
  if (!Number.isFinite(issuedAt)) return false;

  const now = Date.now();
  if (issuedAt > now) return false;
  if (now - issuedAt > TOKEN_TTL_MS) return false;

  const expected = signPayload(slug, passwordHash, issuedAt);
  if (expected.length !== sig.length) return false;
  try {
    return timingSafeEqual(
      Buffer.from(expected, "hex"),
      Buffer.from(sig, "hex")
    );
  } catch {
    return false;
  }
}
