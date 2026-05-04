import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { rateLimitEvents } from "@/db/schema";
import {
  evaluateRateLimit,
  type RateLimitResult,
} from "@/lib/rate-limit/evaluate";

export interface RateLimitStore {
  recentTimestamps(
    scope: string,
    key: string,
    sinceMs: number
  ): Promise<number[]>;
  insert(scope: string, key: string, atMs: number): Promise<void>;
  /** Best-effort cleanup of events older than `olderThanMs`. */
  prune(scope: string, olderThanMs: number): Promise<void>;
}

const dbStore: RateLimitStore = {
  async recentTimestamps(scope, key, sinceMs) {
    const rows = await db
      .select({ occurredAt: rateLimitEvents.occurredAt })
      .from(rateLimitEvents)
      .where(
        and(
          eq(rateLimitEvents.scope, scope),
          eq(rateLimitEvents.key, key),
          gte(rateLimitEvents.occurredAt, new Date(sinceMs))
        )
      );
    return rows.map((r) => r.occurredAt.getTime());
  },
  async insert(scope, key, atMs) {
    await db.insert(rateLimitEvents).values({
      scope,
      key,
      occurredAt: new Date(atMs),
    });
  },
  async prune(scope, olderThanMs) {
    await db.execute(
      sql`DELETE FROM rate_limit_events WHERE scope = ${scope} AND occurred_at < ${new Date(olderThanMs)}`
    );
  },
};

/** In-memory store for tests. Resets each instance — no module-global state. */
export function createInMemoryStore(): RateLimitStore & {
  __dump(): Map<string, number[]>;
} {
  const map = new Map<string, number[]>();
  const k = (scope: string, key: string) => `${scope}:${key}`;
  return {
    async recentTimestamps(scope, key, sinceMs) {
      return (map.get(k(scope, key)) ?? []).filter((t) => t >= sinceMs);
    },
    async insert(scope, key, atMs) {
      const arr = map.get(k(scope, key)) ?? [];
      arr.push(atMs);
      map.set(k(scope, key), arr);
    },
    async prune(scope, olderThanMs) {
      for (const [mk, arr] of map.entries()) {
        if (!mk.startsWith(`${scope}:`)) continue;
        map.set(
          mk,
          arr.filter((t) => t >= olderThanMs)
        );
      }
    },
    __dump() {
      return map;
    },
  };
}

export interface CheckRateLimitOptions {
  scope: string;
  key: string;
  max: number;
  windowSec: number;
  /** Seam for tests. Defaults to Date.now() when omitted. */
  now?: number;
  /** Seam for tests. Defaults to the Drizzle-backed store. */
  store?: RateLimitStore;
}

/**
 * Persistent sliding-window rate-limit check. Atomic-ish: the read happens
 * before the insert, so under heavy concurrency two requests against the
 * same (scope, key) at the same instant could both see "below cap" and
 * both insert. For our scale (per-visitor-hash on viewer-side endpoints)
 * this is acceptable; if it becomes a real problem the store can be moved
 * onto a serializable transaction.
 */
export async function checkRateLimit(
  opts: CheckRateLimitOptions
): Promise<RateLimitResult> {
  const now = opts.now ?? Date.now();
  const windowMs = opts.windowSec * 1000;
  const store = opts.store ?? dbStore;

  const events = await store.recentTimestamps(
    opts.scope,
    opts.key,
    now - windowMs
  );

  const result = evaluateRateLimit(events, {
    max: opts.max,
    windowMs,
    now,
  });

  if (result.allowed) {
    await store.insert(opts.scope, opts.key, now);
    // Opportunistic cleanup: 1% chance per allowed insert. Keeps the table
    // small without a dedicated cron.
    if (Math.random() < 0.01) {
      // Don't await — best-effort, fire-and-forget.
      void store.prune(opts.scope, now - windowMs).catch(() => undefined);
    }
  }

  return result;
}
