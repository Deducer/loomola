import { describe, it, expect, beforeEach } from "vitest";
import {
  checkRateLimit,
  createInMemoryStore,
  type RateLimitStore,
} from "@/lib/rate-limit/check";

const NOW = new Date("2026-05-04T12:00:00Z").getTime();

describe("checkRateLimit (with in-memory store)", () => {
  let store: RateLimitStore;

  beforeEach(() => {
    store = createInMemoryStore();
  });

  it("allows up to max events within the window", async () => {
    for (let i = 0; i < 3; i++) {
      const r = await checkRateLimit({
        scope: "test",
        key: "k1",
        max: 3,
        windowSec: 300,
        now: NOW + i,
        store,
      });
      expect(r.allowed).toBe(true);
    }
  });

  it("blocks the (max+1)th event within the window", async () => {
    for (let i = 0; i < 3; i++) {
      await checkRateLimit({
        scope: "test",
        key: "k1",
        max: 3,
        windowSec: 300,
        now: NOW + i,
        store,
      });
    }
    const r = await checkRateLimit({
      scope: "test",
      key: "k1",
      max: 3,
      windowSec: 300,
      now: NOW + 100,
      store,
    });
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSec).toBeGreaterThan(0);
  });

  it("does NOT insert an event when blocked", async () => {
    for (let i = 0; i < 3; i++) {
      await checkRateLimit({
        scope: "test",
        key: "k1",
        max: 3,
        windowSec: 300,
        now: NOW + i,
        store,
      });
    }
    // Try 100 blocked attempts — all should be rejected.
    for (let i = 0; i < 100; i++) {
      const r = await checkRateLimit({
        scope: "test",
        key: "k1",
        max: 3,
        windowSec: 300,
        now: NOW + 100 + i,
        store,
      });
      expect(r.allowed).toBe(false);
    }
    // After window slides past, allow again.
    const after = await checkRateLimit({
      scope: "test",
      key: "k1",
      max: 3,
      windowSec: 300,
      now: NOW + 300_000 + 1,
      store,
    });
    expect(after.allowed).toBe(true);
  });

  it("counts different keys independently", async () => {
    for (let i = 0; i < 3; i++) {
      await checkRateLimit({
        scope: "test",
        key: "alice",
        max: 3,
        windowSec: 300,
        now: NOW + i,
        store,
      });
    }
    const bob = await checkRateLimit({
      scope: "test",
      key: "bob",
      max: 3,
      windowSec: 300,
      now: NOW,
      store,
    });
    expect(bob.allowed).toBe(true);
  });

  it("counts different scopes independently", async () => {
    for (let i = 0; i < 3; i++) {
      await checkRateLimit({
        scope: "comments:visitor",
        key: "k1",
        max: 3,
        windowSec: 300,
        now: NOW + i,
        store,
      });
    }
    const unlock = await checkRateLimit({
      scope: "unlock:visitor",
      key: "k1",
      max: 5,
      windowSec: 300,
      now: NOW,
      store,
    });
    expect(unlock.allowed).toBe(true);
  });

  it("survives 'simulated process restart' — events are persisted in the store", async () => {
    // The store is the persistence layer. Restarting the process is
    // equivalent to throwing away the in-memory module state but keeping
    // the store intact. We model this by creating a fresh checkRateLimit
    // call that uses the same store object (which represents the DB).
    for (let i = 0; i < 3; i++) {
      await checkRateLimit({
        scope: "test",
        key: "k1",
        max: 3,
        windowSec: 300,
        now: NOW + i,
        store,
      });
    }
    // "Process restart" — call again with same store. Limit still enforced.
    const r = await checkRateLimit({
      scope: "test",
      key: "k1",
      max: 3,
      windowSec: 300,
      now: NOW + 100,
      store,
    });
    expect(r.allowed).toBe(false);
  });
});
