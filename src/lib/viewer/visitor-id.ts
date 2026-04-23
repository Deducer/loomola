import { createHash } from "node:crypto";

function getSalt(): string {
  const s = process.env.VISITOR_HASH_SALT;
  if (!s) throw new Error("VISITOR_HASH_SALT is not set");
  return s;
}

/**
 * Derives a stable anonymous visitor id from the request's IP and User-Agent.
 * Uses the first address from X-Forwarded-For (falls back to X-Real-IP, then
 * empty string). User-Agent is truncated to 64 chars to keep the hash input
 * bounded and reduce churn from long UA strings.
 */
export function hashVisitor(request: Request): string {
  const xff = request.headers.get("x-forwarded-for") ?? "";
  const xri = request.headers.get("x-real-ip") ?? "";
  const ipRaw = xff.split(",")[0]?.trim() || xri.trim() || "";
  const ua = (request.headers.get("user-agent") ?? "").slice(0, 64);

  return createHash("sha256")
    .update(`${ipRaw}\n${ua}\n${getSalt()}`)
    .digest("hex");
}
