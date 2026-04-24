const WINDOW_MS = 5 * 60 * 1000;
const LIMIT = 3;
const MAX_ENTRIES = 10_000;

const hits = new Map<string, number[]>();

/**
 * In-memory sliding-window rate limit. 3 hits per 5 minutes per visitor hash.
 * LRU-bounded at 10k distinct visitors to keep memory bounded. Process-local
 * — does not survive restarts, which is acceptable at this scale.
 */
export function checkAndBump(visitorHash: string): {
  allowed: boolean;
  retryAfterSec?: number;
} {
  const now = Date.now();
  const cutoff = now - WINDOW_MS;

  let times = hits.get(visitorHash) ?? [];
  times = times.filter((t) => t > cutoff);

  if (times.length >= LIMIT) {
    const oldest = times[0];
    const retryAfterSec = Math.max(1, Math.ceil((oldest + WINDOW_MS - now) / 1000));
    hits.set(visitorHash, times);
    return { allowed: false, retryAfterSec };
  }

  times.push(now);
  hits.set(visitorHash, times);

  if (hits.size > MAX_ENTRIES) {
    const toEvict = Math.ceil(MAX_ENTRIES / 4);
    let i = 0;
    for (const key of hits.keys()) {
      if (i++ >= toEvict) break;
      hits.delete(key);
    }
  }

  return { allowed: true };
}

/** Test-only reset. Not part of the public module contract. */
export function __resetForTest(): void {
  hits.clear();
}
