import { describe, it, expect } from "vitest";
import { bucketize } from "@/lib/viewer/dropoff";

describe("bucketize", () => {
  it("returns an array of zeros for no viewers", () => {
    expect(bucketize([], 60)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("places a single viewer at the exact half-mark in bucket 5", () => {
    const buckets = bucketize([30], 60);
    expect(buckets[5]).toBe(1);
    expect(buckets.reduce((a, b) => a + b, 0)).toBe(1);
  });

  it("places a viewer at 0 seconds in bucket 0", () => {
    expect(bucketize([0], 60)[0]).toBe(1);
  });

  it("clamps a viewer who watched longer than the duration to the last bucket", () => {
    const buckets = bucketize([9999], 60);
    expect(buckets[9]).toBe(1);
  });

  it("groups many viewers correctly", () => {
    const buckets = bucketize([5, 5, 15, 25, 25, 25, 60], 60);
    expect(buckets[0]).toBe(2);
    expect(buckets[2]).toBe(1);
    expect(buckets[4]).toBe(3);
    expect(buckets[9]).toBe(1);
  });

  it("respects a custom bucket count", () => {
    const buckets = bucketize([30], 60, 4);
    expect(buckets).toHaveLength(4);
    expect(buckets[2]).toBe(1);
  });

  it("returns all zeros when duration is 0 (defensive)", () => {
    expect(bucketize([10], 0)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });
});
