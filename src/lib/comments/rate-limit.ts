import {
  checkRateLimit,
  type RateLimitStore,
} from "@/lib/rate-limit/check";
import type { RateLimitResult } from "@/lib/rate-limit/evaluate";

const SCOPE = "comments:visitor";
// 10, not the original 3: a reviewer leaves several notes in a row on one
// draft. Still slow enough to stop scripted spam (and the owner's email).
export const COMMENT_RATE_MAX = 10;
const MAX = COMMENT_RATE_MAX;
const WINDOW_SEC = 5 * 60;

/**
 * Persistent sliding-window rate limit for visitor comments. 10 hits per
 * 5 minutes per visitor hash, backed by Postgres `rate_limit_events` so it
 * survives restarts and horizontal scale.
 */
export async function checkAndBump(
  visitorHash: string,
  opts: { now?: number; store?: RateLimitStore } = {}
): Promise<RateLimitResult> {
  return checkRateLimit({
    scope: SCOPE,
    key: visitorHash,
    max: MAX,
    windowSec: WINDOW_SEC,
    now: opts.now,
    store: opts.store,
  });
}
