import { createHash } from "node:crypto";

function getSalt(): string {
  const s = process.env.VISITOR_HASH_SALT;
  if (!s) throw new Error("VISITOR_HASH_SALT is not set");
  return s;
}

/**
 * Derives a stable anonymous visitor id from the request's IP and User-Agent.
 * Uses the LAST address from X-Forwarded-For — that's the entry the reverse
 * proxy (Traefik) appended from the real TCP socket, which a public attacker
 * cannot forge; their spoofed values land to the LEFT of it. Using the first
 * entry let anyone mint unlimited visitor hashes and walk straight through
 * every rate limit keyed on this (unlock brute-force, comments) and flood the
 * owner with first-view emails. Same reasoning as extractSourceCandidate in
 * src/app/api/mcp/auth.ts. Falls back to X-Real-IP, then empty string.
 * User-Agent is truncated to 64 chars to keep the hash input bounded.
 */
export function hashVisitor(request: Request): string {
  const xff = request.headers.get("x-forwarded-for") ?? "";
  const xri = request.headers.get("x-real-ip") ?? "";
  const xffParts = xff
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  const ipRaw = xffParts[xffParts.length - 1] || xri.trim() || "";
  const ua = (request.headers.get("user-agent") ?? "").slice(0, 64);

  return createHash("sha256")
    .update(`${ipRaw}\n${ua}\n${getSalt()}`)
    .digest("hex");
}

/**
 * IP-only variant for rate-limit keys. hashVisitor mixes in the User-Agent,
 * which the client controls — rotating it mints a fresh visitor hash per
 * request, so a per-visitor limit on a notification-sending endpoint (e.g.
 * the view beacon) would be a no-op. The proxy-appended IP is the only
 * request property the client can't rotate freely.
 */
export function hashVisitorIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for") ?? "";
  const xri = request.headers.get("x-real-ip") ?? "";
  const xffParts = xff
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  const ipRaw = xffParts[xffParts.length - 1] || xri.trim() || "";

  return createHash("sha256").update(`${ipRaw}\n${getSalt()}`).digest("hex");
}
