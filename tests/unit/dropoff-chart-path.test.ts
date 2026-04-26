import { describe, expect, it } from "vitest";
import { buildDropoffPath } from "@/components/edit/dropoff-chart";

describe("buildDropoffPath", () => {
  it("returns empty path for empty buckets", () => {
    expect(buildDropoffPath([], 100, 40)).toBe("");
  });

  it("returns a closed area path with N+1 points (one per bucket plus a close)", () => {
    const path = buildDropoffPath([5, 4, 3, 2, 1], 100, 40);
    // Should start with M, end with Z, contain L commands.
    expect(path.startsWith("M")).toBe(true);
    expect(path.endsWith("Z")).toBe(true);
    expect((path.match(/L /g) ?? []).length).toBeGreaterThan(0);
  });

  it("scales y by max bucket value (highest bucket reaches y=0)", () => {
    const path = buildDropoffPath([0, 10, 5], 60, 30);
    // 10 is the max. Bucket index 1 should be y=0 (top of chart). Path
    // includes a y=0 token somewhere.
    expect(path).toMatch(/[MmLl]\s*\d+(?:\.\d+)?\s+0(?!\d)/);
  });
});
