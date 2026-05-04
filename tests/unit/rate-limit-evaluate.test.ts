import { describe, it, expect } from "vitest";
import { evaluateRateLimit } from "@/lib/rate-limit/evaluate";

const NOW = new Date("2026-05-04T12:00:00Z").getTime();
const FIVE_MIN = 5 * 60 * 1000;

describe("evaluateRateLimit", () => {
  it("allows when there are zero past events", () => {
    const r = evaluateRateLimit([], { max: 3, windowMs: FIVE_MIN, now: NOW });
    expect(r.allowed).toBe(true);
    expect(r.retryAfterSec).toBeUndefined();
  });

  it("allows when past events are below the cap", () => {
    const events = [NOW - 10_000, NOW - 5_000];
    const r = evaluateRateLimit(events, {
      max: 3,
      windowMs: FIVE_MIN,
      now: NOW,
    });
    expect(r.allowed).toBe(true);
  });

  it("blocks when past events meet the cap", () => {
    const events = [NOW - 10_000, NOW - 5_000, NOW - 1_000];
    const r = evaluateRateLimit(events, {
      max: 3,
      windowMs: FIVE_MIN,
      now: NOW,
    });
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSec).toBeGreaterThan(0);
    expect(r.retryAfterSec).toBeLessThanOrEqual(300);
  });

  it("ignores events older than the window", () => {
    const events = [NOW - FIVE_MIN - 1_000, NOW - FIVE_MIN - 2_000];
    const r = evaluateRateLimit(events, {
      max: 3,
      windowMs: FIVE_MIN,
      now: NOW,
    });
    expect(r.allowed).toBe(true);
  });

  it("computes retryAfter from the oldest in-window event", () => {
    const oldest = NOW - 60_000; // one minute ago
    const events = [oldest, NOW - 30_000, NOW - 5_000];
    const r = evaluateRateLimit(events, {
      max: 3,
      windowMs: FIVE_MIN,
      now: NOW,
    });
    expect(r.allowed).toBe(false);
    // retryAfter ≈ window - (now - oldest) = 300 - 60 = 240s
    expect(r.retryAfterSec).toBeGreaterThanOrEqual(239);
    expect(r.retryAfterSec).toBeLessThanOrEqual(241);
  });

  it("treats unsorted events identically (sorts internally)", () => {
    const events = [NOW - 5_000, NOW - 60_000, NOW - 30_000];
    const r = evaluateRateLimit(events, {
      max: 3,
      windowMs: FIVE_MIN,
      now: NOW,
    });
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSec).toBeGreaterThanOrEqual(239);
    expect(r.retryAfterSec).toBeLessThanOrEqual(241);
  });

  it("retryAfter is at least 1 second when oldest event is exactly at the boundary", () => {
    const events = [NOW - FIVE_MIN, NOW - 1_000, NOW];
    const r = evaluateRateLimit(events, {
      max: 3,
      windowMs: FIVE_MIN,
      now: NOW,
    });
    if (!r.allowed) {
      expect(r.retryAfterSec).toBeGreaterThanOrEqual(1);
    }
  });

  it("works with max=1 (single-shot rate limit)", () => {
    expect(
      evaluateRateLimit([], { max: 1, windowMs: 60_000, now: NOW }).allowed
    ).toBe(true);
    expect(
      evaluateRateLimit([NOW - 1000], {
        max: 1,
        windowMs: 60_000,
        now: NOW,
      }).allowed
    ).toBe(false);
  });
});
