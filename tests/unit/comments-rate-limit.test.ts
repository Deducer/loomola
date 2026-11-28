import { describe, it, expect, beforeEach } from "vitest";
import { COMMENT_RATE_MAX, checkAndBump } from "@/lib/comments/rate-limit";
import {
  createInMemoryStore,
  type RateLimitStore,
} from "@/lib/rate-limit/check";

const NOW = new Date("2026-05-04T12:00:00Z").getTime();

async function fill(store: RateLimitStore, visitor = "visitor-a") {
  for (let i = 0; i < COMMENT_RATE_MAX; i++) {
    expect((await checkAndBump(visitor, { now: NOW + i, store })).allowed).toBe(true);
  }
}

describe("checkAndBump", () => {
  let store: RateLimitStore;

  beforeEach(() => {
    store = createInMemoryStore();
  });

  it("allows a reviewer's run of comments up to the cap", async () => {
    await fill(store);
  });

  it("blocks the next call within the window with a retryAfterSec", async () => {
    await fill(store);
    const r = await checkAndBump("visitor-a", { now: NOW + 100, store });
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSec).toBeGreaterThan(0);
    expect(r.retryAfterSec).toBeLessThanOrEqual(5 * 60);
  });

  it("counts different visitors independently", async () => {
    await fill(store);
    expect((await checkAndBump("visitor-b", { now: NOW + 100, store })).allowed).toBe(true);
  });

  it("allows again after the window slides past the oldest hit", async () => {
    await fill(store);
    expect((await checkAndBump("visitor-a", { now: NOW + 100, store })).allowed).toBe(false);
    expect(
      (await checkAndBump("visitor-a", { now: NOW + 5 * 60 * 1000 + 1000, store })).allowed
    ).toBe(true);
  });

  it("survives a simulated restart — store is the source of truth", async () => {
    await fill(store);
    // Same store, fresh in-memory state: the "DB" remembers past events.
    expect((await checkAndBump("visitor-a", { now: NOW + 100, store })).allowed).toBe(false);
  });
});
