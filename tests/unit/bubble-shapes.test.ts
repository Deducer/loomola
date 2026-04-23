// @vitest-environment happy-dom
import { describe, it, expect, beforeAll } from "vitest";

// happy-dom doesn't ship Path2D. Polyfill with a minimal stub that records
// method calls — our shape factory only calls methods on the path, it never
// needs the real Path2D behaviour to produce valid output.
class Path2DStub {
  readonly calls: Array<{ op: string; args: unknown[] }> = [];
  arc(...args: unknown[]) { this.calls.push({ op: "arc", args }); }
  moveTo(...args: unknown[]) { this.calls.push({ op: "moveTo", args }); }
  lineTo(...args: unknown[]) { this.calls.push({ op: "lineTo", args }); }
  quadraticCurveTo(...args: unknown[]) { this.calls.push({ op: "quadraticCurveTo", args }); }
  rect(...args: unknown[]) { this.calls.push({ op: "rect", args }); }
  closePath() { this.calls.push({ op: "closePath", args: [] }); }
}

beforeAll(() => {
  (globalThis as unknown as { Path2D: typeof Path2DStub }).Path2D = Path2DStub;
});

import { createBubblePath, getBubbleBounds } from "@/lib/recording/bubble-shapes";

describe("createBubblePath", () => {
  it("draws an arc for circle", () => {
    const p = createBubblePath("circle", 100, 100, 50) as unknown as Path2DStub;
    expect(p.calls.some((c) => c.op === "arc")).toBe(true);
  });

  it("builds a closed path of quadratic curves for rounded-square", () => {
    const p = createBubblePath("rounded-square", 100, 100, 50) as unknown as Path2DStub;
    expect(p.calls.some((c) => c.op === "quadraticCurveTo")).toBe(true);
  });

  it("calls rect for rectangle", () => {
    const p = createBubblePath("rectangle", 100, 100, 50) as unknown as Path2DStub;
    expect(p.calls.some((c) => c.op === "rect")).toBe(true);
  });

  it("traces 6 vertices for hexagon", () => {
    const p = createBubblePath("hexagon", 100, 100, 50) as unknown as Path2DStub;
    const moves = p.calls.filter((c) => c.op === "moveTo").length;
    const lines = p.calls.filter((c) => c.op === "lineTo").length;
    expect(moves + lines).toBe(6);
  });
});

describe("getBubbleBounds", () => {
  it("centers the circle on the given point", () => {
    const b = getBubbleBounds("circle", 200, 150, 100);
    expect(b).toEqual({ x: 150, y: 100, width: 100, height: 100 });
  });

  it("widens rectangles to 4:3 aspect", () => {
    const b = getBubbleBounds("rectangle", 0, 0, 90);
    expect(b.width).toBe(120);
    expect(b.height).toBe(90);
  });

  it("returns a square for rounded-square shape", () => {
    const b = getBubbleBounds("rounded-square", 0, 0, 80);
    expect(b.width).toBe(b.height);
  });
});
