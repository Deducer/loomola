import { describe, expect, it } from "vitest";
import { computeSegments } from "@/components/viewer/chapter-segments";

describe("computeSegments", () => {
  it("returns empty array when no chapters", () => {
    expect(computeSegments([], 100)).toEqual([]);
  });

  it("returns full-width single segment for one chapter", () => {
    const segs = computeSegments([{ start_sec: 0, title: "Intro" }], 60);
    expect(segs).toHaveLength(1);
    expect(segs[0].leftPct).toBe(0);
    expect(segs[0].widthPct).toBeCloseTo(100, 5);
    expect(segs[0].title).toBe("Intro");
  });

  it("computes left + width from start times and total duration", () => {
    const chapters = [
      { start_sec: 0, title: "A" },
      { start_sec: 30, title: "B" },
      { start_sec: 75, title: "C" },
    ];
    const segs = computeSegments(chapters, 100);
    expect(segs[0].leftPct).toBe(0);
    expect(segs[0].widthPct).toBeCloseTo(30, 5);
    expect(segs[1].leftPct).toBe(30);
    expect(segs[1].widthPct).toBeCloseTo(45, 5);
    expect(segs[2].leftPct).toBe(75);
    expect(segs[2].widthPct).toBeCloseTo(25, 5);
  });

  it("treats out-of-order chapters by sorting them by start_sec", () => {
    const chapters = [
      { start_sec: 30, title: "B" },
      { start_sec: 0, title: "A" },
    ];
    const segs = computeSegments(chapters, 60);
    expect(segs[0].title).toBe("A");
    expect(segs[1].title).toBe("B");
  });

  it("returns empty array when totalDuration is 0 or negative", () => {
    expect(computeSegments([{ start_sec: 0, title: "X" }], 0)).toEqual([]);
    expect(computeSegments([{ start_sec: 0, title: "X" }], -1)).toEqual([]);
  });

  it("clamps an out-of-range chapter start to the duration", () => {
    const chapters = [
      { start_sec: 0, title: "A" },
      { start_sec: 200, title: "B" },
    ];
    const segs = computeSegments(chapters, 100);
    // B's start is clamped to 100, producing zero width — so we drop it.
    expect(segs).toHaveLength(1);
  });
});
