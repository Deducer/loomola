import { createHmac, timingSafeEqual } from "node:crypto";

function getSecret(): string {
  const s = process.env.VIEW_UNLOCK_SECRET;
  if (!s) throw new Error("VIEW_UNLOCK_SECRET is not set");
  return s;
}

export function cookieName(slug: string): string {
  return `view_unlock_${slug}`;
}

/**
 * Signs a slug+password-hash pair into a hex HMAC. The password hash is in
 * the signing path so that changing the password implicitly invalidates all
 * outstanding unlock cookies.
 */
export function signUnlockToken({
  slug,
  passwordHash,
}: {
  slug: string;
  passwordHash: string;
}): string {
  return createHmac("sha256", getSecret())
    .update(`${slug}:${passwordHash}`)
    .digest("hex");
}

/**
 * Constant-time HMAC compare. Returns false when passwordHash is null (no
 * password is currently set — any cookie should be considered stale) or on
 * any length/parse mismatch.
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
  const expected = signUnlockToken({ slug, passwordHash });
  if (expected.length !== token.length) return false;
  try {
    return timingSafeEqual(
      Buffer.from(expected, "hex"),
      Buffer.from(token, "hex")
    );
  } catch {
    return false;
  }
}
