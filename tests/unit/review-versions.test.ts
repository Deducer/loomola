import { describe, expect, it } from "vitest";
import {
  baseTitle,
  compareDefaults,
  driftCorrection,
  isPermutation,
  moveVersion,
  orderVersions,
  versionPosition,
} from "@/lib/review/versions";

const v = (id: string, n: number | null, day: number) => ({
  id,
  versionNumber: n,
  createdAt: new Date(Date.UTC(2026, 10, day)),
});

describe("orderVersions", () => {
  it("orders by version number with gaps, then creation time", () => {
    const ordered = orderVersions([v("c", 7, 3), v("a", 1, 1), v("x", null, 0), v("b", 3, 2)]);
    expect(ordered.map((r) => r.id)).toEqual(["a", "b", "c", "x"]);
    expect(versionPosition(ordered, "c")).toBe(3);
    expect(versionPosition(ordered, "missing")).toBe(1);
  });
});

describe("moveVersion / isPermutation", () => {
  it("swaps neighbours and ignores moves off the ends", () => {
    expect(moveVersion(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"]);
    expect(moveVersion(["a", "b", "c"], "c", 1)).toEqual(["a", "b", "c"]);
  });
  it("accepts only an exact reordering", () => {
    expect(isPermutation(["a", "b"], ["b", "a"])).toBe(true);
    expect(isPermutation(["a", "b"], ["a", "a"])).toBe(false);
    expect(isPermutation(["a", "b"], ["a", "b", "c"])).toBe(false);
  });
});

describe("compareDefaults", () => {
  it("is previous vs current, or v1 vs v2 from the first", () => {
    expect(compareDefaults(4, 4)).toEqual({ left: 3, right: 4 });
    expect(compareDefaults(4, 1)).toEqual({ left: 1, right: 2 });
    expect(compareDefaults(1, 1)).toBeNull();
  });
});

describe("baseTitle", () => {
  it("drops a trailing version tag", () => {
    expect(baseTitle("Seedance hero v3")).toBe("Seedance hero");
    expect(baseTitle("v2 of nothing")).toBe("v2 of nothing");
    expect(baseTitle(null)).toBe("");
  });
});

describe("driftCorrection", () => {
  it("leaves players within a frame alone", () => {
    expect(driftCorrection(10, 10.02, 30)).toEqual({ seekTo: null, rate: 1 });
  });
  it("nudges speed for small drift, toward the reference", () => {
    expect(driftCorrection(10, 9.9, 30).rate).toBeGreaterThan(1);
    expect(driftCorrection(10, 10.1, 30).rate).toBeLessThan(1);
    expect(driftCorrection(10, 9.9, 30).seekTo).toBeNull();
    expect(driftCorrection(10, 9.8, 30).rate).toBeLessThanOrEqual(1.1);
  });
  it("seeks only past a quarter second", () => {
    expect(driftCorrection(10, 9.5, 0)).toEqual({ seekTo: 10, rate: 1 });
  });
});
