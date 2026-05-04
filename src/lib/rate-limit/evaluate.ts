export interface RateLimitOptions {
  max: number;
  windowMs: number;
  now: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the next slot opens. Set when allowed=false. */
  retryAfterSec?: number;
}

/**
 * Pure rate-limit decision over an array of past event timestamps (in ms).
 *
 * - Counts events newer than (now - windowMs).
 * - Allowed when in-window count is strictly less than `max`.
 * - On block, computes retryAfter from the oldest in-window event.
 *
 * No I/O, no global state — the storage layer feeds events in and decides
 * whether to record a new event based on the result.
 */
export function evaluateRateLimit(
  events: ReadonlyArray<number>,
  opts: RateLimitOptions
): RateLimitResult {
  const cutoff = opts.now - opts.windowMs;
  const recent = events.filter((t) => t > cutoff);
  if (recent.length < opts.max) {
    return { allowed: true };
  }
  const oldest = Math.min(...recent);
  const msUntilFree = oldest + opts.windowMs - opts.now;
  const retryAfterSec = Math.max(1, Math.ceil(msUntilFree / 1000));
  return { allowed: false, retryAfterSec };
}
