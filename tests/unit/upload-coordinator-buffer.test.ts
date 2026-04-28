import { describe, expect, it } from "vitest";
import { takeExactBytes } from "@/lib/recording/upload-coordinator";

function makeBlob(size: number): Blob {
  // Vitest in node environment doesn't have a native Blob built around byte
  // sizes the way browsers do; the polyfill / Node 22 implementation does.
  return new Blob([new Uint8Array(size)]);
}

describe("takeExactBytes", () => {
  it("takes exactly N bytes split across multiple blobs", () => {
    const blobs = [makeBlob(3), makeBlob(5), makeBlob(2)];
    const { taken, remaining, takenSize } = takeExactBytes(blobs, 7);
    expect(takenSize).toBe(7);
    const totalTaken = taken.reduce((s, b) => s + b.size, 0);
    expect(totalTaken).toBe(7);
    const totalRemaining = remaining.reduce((s, b) => s + b.size, 0);
    expect(totalRemaining).toBe(3);
  });

  it("splits a single blob if the boundary lands inside it", () => {
    const blobs = [makeBlob(10)];
    const { taken, remaining, takenSize } = takeExactBytes(blobs, 4);
    expect(takenSize).toBe(4);
    expect(taken.reduce((s, b) => s + b.size, 0)).toBe(4);
    expect(remaining.reduce((s, b) => s + b.size, 0)).toBe(6);
  });

  it("returns empty remaining when the buffer exactly equals the target", () => {
    const blobs = [makeBlob(4), makeBlob(4)];
    const { taken, remaining, takenSize } = takeExactBytes(blobs, 8);
    expect(takenSize).toBe(8);
    expect(remaining).toHaveLength(0);
  });

  it("returns less than target if the buffer is smaller", () => {
    const blobs = [makeBlob(2)];
    const { taken, remaining, takenSize } = takeExactBytes(blobs, 10);
    expect(takenSize).toBe(2);
    expect(remaining).toHaveLength(0);
    expect(taken).toHaveLength(1);
  });

  it("preserves order across the split", () => {
    const blobs = [makeBlob(3), makeBlob(5)];
    const { taken, remaining } = takeExactBytes(blobs, 4);
    // First blob fully taken, second blob split: 1 byte taken, 4 remaining
    expect(taken).toHaveLength(2);
    expect(taken[0].size).toBe(3);
    expect(taken[1].size).toBe(1);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].size).toBe(4);
  });
});
