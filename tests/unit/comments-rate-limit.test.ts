import { describe, it, expect, beforeEach } from "vitest";
import { checkAndBump } from "@/lib/comments/rate-limit";
import {
  createInMemoryStore,
  type RateLimitStore,
} from "@/lib/rate-limit/check";

const NOW = new Date("2026-05-04T12:00:00Z").getTime();

describe("checkAndBump", () => {
  let store: RateLimitStore;

  beforeEach(() => {
    store = createInMemoryStore();
  });

  it("allows the first three calls from one visitor", async () => {
    expect(
      (await checkAndBump("visitor-a", { now: NOW + 0, store })).allowed
    ).toBe(true);
    expect(
      (await checkAndBump("visitor-a", { now: NOW + 1, store })).allowed
    ).toBe(true);
    expect(
      (await checkAndBump("visitor-a", { now: NOW + 2, store })).allowed
    ).toBe(true);
  });

  it("blocks the fourth call within the window with a retryAfterSec", async () => {
    await checkAndBump("visitor-a", { now: NOW + 0, store });
    await checkAndBump("visitor-a", { now: NOW + 1, store });
    await checkAndBump("visitor-a", { now: NOW + 2, store });
    const r = await checkAndBump("visitor-a", { now: NOW + 3, store });
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSec).toBeGreaterThan(0);
    expect(r.retryAfterSec).toBeLessThanOrEqual(5 * 60);
  });

  it("counts different visitors independently", async () => {
    await checkAndBump("visitor-a", { now: NOW + 0, store });
    await checkAndBump("visitor-a", { now: NOW + 1, store });
    await checkAndBump("visitor-a", { now: NOW + 2, store });
    expect(
      (await checkAndBump("visitor-b", { now: NOW + 3, store })).allowed
    ).toBe(true);
  });

  it("allows again after the window slides past the oldest hit", async () => {
    await checkAndBump("visitor-a", { now: NOW + 0, store });
    await checkAndBump("visitor-a", { now: NOW + 1, store });
    await checkAndBump("visitor-a", { now: NOW + 2, store });
    expect(
      (await checkAndBump("visitor-a", { now: NOW + 3, store })).allowed
    ).toBe(false);

    // Advance past the window.
    expect(
      (
        await checkAndBump("visitor-a", {
          now: NOW + 5 * 60 * 1000 + 1000,
          store,
        })
      ).allowed
    ).toBe(true);
  });

  it("survives a simulated restart — store is the source of truth", async () => {
    await checkAndBump("visitor-a", { now: NOW + 0, store });
    await checkAndBump("visitor-a", { now: NOW + 1, store });
    await checkAndBump("visitor-a", { now: NOW + 2, store });
    // Simulate process restart: same store, fresh in-memory state. The
    // rate limit still trips because the "DB" remembers the past events.
    expect(
      (await checkAndBump("visitor-a", { now: NOW + 3, store })).allowed
    ).toBe(false);
  });
});
