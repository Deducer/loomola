import {
  checkRateLimit,
  type RateLimitStore,
} from "@/lib/rate-limit/check";
import type { RateLimitResult } from "@/lib/rate-limit/evaluate";

const SCOPE = "comments:visitor";
const MAX = 3;
const WINDOW_SEC = 5 * 60;

/**
 * Persistent sliding-window rate limit for visitor comments. 3 hits per
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
