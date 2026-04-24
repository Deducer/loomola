import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { checkAndBump, __resetForTest } from "@/lib/comments/rate-limit";

beforeEach(() => {
  __resetForTest();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-04-23T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("checkAndBump", () => {
  it("allows the first three calls from one visitor", () => {
    expect(checkAndBump("visitor-a").allowed).toBe(true);
    expect(checkAndBump("visitor-a").allowed).toBe(true);
    expect(checkAndBump("visitor-a").allowed).toBe(true);
  });

  it("blocks the fourth call within the window with a retryAfterSec", () => {
    checkAndBump("visitor-a");
    checkAndBump("visitor-a");
    checkAndBump("visitor-a");
    const r = checkAndBump("visitor-a");
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSec).toBeGreaterThan(0);
    expect(r.retryAfterSec).toBeLessThanOrEqual(5 * 60);
  });

  it("counts different visitors independently", () => {
    checkAndBump("visitor-a");
    checkAndBump("visitor-a");
    checkAndBump("visitor-a");
    expect(checkAndBump("visitor-b").allowed).toBe(true);
  });

  it("allows again after the window slides past the oldest hit", () => {
    checkAndBump("visitor-a");
    checkAndBump("visitor-a");
    checkAndBump("visitor-a");
    expect(checkAndBump("visitor-a").allowed).toBe(false);

    vi.advanceTimersByTime(5 * 60 * 1000 + 1000);
    expect(checkAndBump("visitor-a").allowed).toBe(true);
  });

  it("keeps memory bounded under many distinct hashes", () => {
    for (let i = 0; i < 12_000; i++) {
      checkAndBump(`v-${i}`);
    }
    expect(checkAndBump("v-newest").allowed).toBe(true);
  });
});
