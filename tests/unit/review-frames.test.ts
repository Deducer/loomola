import { describe, expect, it } from "vitest";
import {
  effectiveFps,
  formatTimecode,
  frameIndex,
  parseFrameRate,
  sanitizeFps,
  snapToFrame,
  stepFrame,
} from "@/lib/review/frames";
import { toFrameFraction, videoContentBox } from "@/lib/review/content-box";

describe("frame maths", () => {
  it("snaps to the middle of the containing frame", () => {
    expect(snapToFrame(1.01, 24)).toBeCloseTo((24 + 0.5) / 24, 9);
    expect(snapToFrame(0, 30)).toBeCloseTo(0.5 / 30, 9);
  });

  it("is stable on exact frame boundaries", () => {
    expect(frameIndex(2 / 30, 30)).toBe(2);
    expect(frameIndex(snapToFrame(2 / 30, 30), 30)).toBe(2);
  });

  it("steps one frame and clamps to the ends", () => {
    const t = snapToFrame(1, 25);
    expect(frameIndex(stepFrame(t, 25, 1), 25)).toBe(26);
    expect(frameIndex(stepFrame(t, 25, -1), 25)).toBe(24);
    expect(stepFrame(0, 25, -1)).toBeCloseTo(0.5 / 25, 9);
    expect(stepFrame(9.99, 25, 1, 10)).toBeLessThan(10);
  });

  it("formats m:ss without fps and m:ss:ff with it", () => {
    expect(formatTimecode(62.9, null)).toBe("1:02");
    expect(formatTimecode(snapToFrame(62 + 7 / 24, 24), 24)).toBe("1:02:07");
    expect(formatTimecode(3725, null)).toBe("1:02:05");
  });

  it("parses and sanity-checks probed rates", () => {
    expect(parseFrameRate("30000/1001")).toBeCloseTo(29.97, 2);
    expect(parseFrameRate("24/1")).toBe(24);
    expect(parseFrameRate("1000/1")).toBeNull();
    expect(parseFrameRate("0/0")).toBeNull();
    expect(sanitizeFps(0.5)).toBeNull();
    expect(effectiveFps(null)).toBe(30);
  });
});

describe("videoContentBox", () => {
  it("letterboxes a wide video in a taller box", () => {
    expect(videoContentBox(1600, 900, 1920, 800)).toEqual({ x: 0, y: (900 - 1600 / 2.4) / 2, width: 1600, height: 1600 / 2.4 });
  });

  it("pillarboxes a 9:16 video in a 16:9 stage", () => {
    const b = videoContentBox(1600, 900, 1080, 1920);
    expect(b.height).toBe(900);
    expect(b.width).toBeCloseTo(506.25, 6);
    expect(b.x).toBeCloseTo((1600 - 506.25) / 2, 6);
  });

  it("fills the element when shapes match or metadata is missing", () => {
    expect(videoContentBox(1600, 900, 1920, 1080)).toEqual({ x: 0, y: 0, width: 1600, height: 900 });
    expect(videoContentBox(800, 450, 0, 0)).toEqual({ x: 0, y: 0, width: 800, height: 450 });
  });

  it("maps pointer positions to clamped frame fractions", () => {
    const b = videoContentBox(1600, 900, 1080, 1920);
    expect(toFrameFraction(b.x, 0, b)).toEqual([0, 0]);
    expect(toFrameFraction(b.x + b.width / 2, 450, b)).toEqual([0.5, 0.5]);
    expect(toFrameFraction(0, 2000, b)).toEqual([0, 1]);
  });
});
