import { describe, expect, it } from "vitest";
import {
  MAX_PART_ATTEMPTS,
  partRetryDelayMs,
} from "@/lib/recording/upload-coordinator";

describe("part upload retry policy", () => {
  it("allows 1 initial attempt + 3 retries", () => {
    expect(MAX_PART_ATTEMPTS).toBe(4);
  });

  it("backs off exponentially: 1s, 2s, 4s at the jitter midpoint", () => {
    const mid = () => 0.5; // 0.5 + 0.5 → exactly 1.0x
    expect(partRetryDelayMs(0, mid)).toBe(1000);
    expect(partRetryDelayMs(1, mid)).toBe(2000);
    expect(partRetryDelayMs(2, mid)).toBe(4000);
  });

  it("jitters within 0.5x–1.5x of the base", () => {
    expect(partRetryDelayMs(0, () => 0)).toBe(500);
    expect(partRetryDelayMs(0, () => 0.9999)).toBeGreaterThan(1490);
    expect(partRetryDelayMs(0, () => 0.9999)).toBeLessThan(1500);
    for (let i = 0; i < 50; i++) {
      const d = partRetryDelayMs(1, Math.random);
      expect(d).toBeGreaterThanOrEqual(1000);
      expect(d).toBeLessThanOrEqual(3000);
    }
  });
});
