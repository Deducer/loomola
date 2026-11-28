import { describe, expect, it } from "vitest";
import {
  MAX_ANNOTATION_BYTES,
  MAX_STROKES,
  isEmptyAnnotation,
  parseAnnotation,
  simplifyStroke,
} from "@/lib/review/annotation";
import { parseCommentInput } from "@/lib/review/comment-input";

const pen = (n = 3) => ({
  tool: "pen",
  color: "#FF4D4F",
  width: 0.004,
  points: Array.from({ length: n }, (_, i) => [i / (n + 1), 0.5]),
});

describe("parseAnnotation", () => {
  it("accepts a pin and palette strokes", () => {
    const r = parseAnnotation({
      pin: { x: 0.2, y: 0.8 },
      strokes: [pen(), { tool: "arrow", color: "#40A9FF", width: 0.004, points: [[0, 0], [1, 1]] }],
    });
    expect(r.ok && r.annotation?.strokes).toHaveLength(2);
  });

  it("treats absent and empty as no annotation", () => {
    expect(parseAnnotation(undefined)).toEqual({ ok: true, annotation: null });
    expect(parseAnnotation({ strokes: [] })).toEqual({ ok: true, annotation: null });
  });

  it("rejects colours outside the palette", () => {
    expect(parseAnnotation({ strokes: [{ ...pen(), color: "red;background:url(x)" }] }).ok).toBe(false);
    expect(parseAnnotation({ strokes: [{ ...pen(), color: "#123456" }] }).ok).toBe(false);
  });

  it("rejects coordinates outside the frame", () => {
    expect(parseAnnotation({ pin: { x: 1.2, y: 0.5 } }).ok).toBe(false);
    expect(parseAnnotation({ strokes: [{ ...pen(), points: [[0, -0.1]] }] }).ok).toBe(false);
  });

  it("rejects too many strokes, unknown keys and two-point tools with other counts", () => {
    expect(parseAnnotation({ strokes: Array.from({ length: MAX_STROKES + 1 }, () => pen()) }).ok).toBe(false);
    expect(parseAnnotation({ pin: { x: 0, y: 0 }, style: "x" }).ok).toBe(false);
    expect(parseAnnotation({ strokes: [{ ...pen(3), tool: "rect" }] }).ok).toBe(false);
  });

  it("rejects payloads over the byte cap", () => {
    const big = { strokes: Array.from({ length: 20 }, () => pen(450)) };
    expect(JSON.stringify(big).length).toBeGreaterThan(MAX_ANNOTATION_BYTES);
    expect(parseAnnotation(big)).toEqual({ ok: false, error: "annotation_too_large" });
  });

  it("isEmptyAnnotation", () => {
    expect(isEmptyAnnotation(null)).toBe(true);
    expect(isEmptyAnnotation({ strokes: [] })).toBe(true);
    expect(isEmptyAnnotation({ pin: { x: 0, y: 0 } })).toBe(false);
  });
});

describe("simplifyStroke", () => {
  it("drops near-duplicate points and keeps the end", () => {
    const out = simplifyStroke([[0, 0], [0.0001, 0], [0.5, 0.5], [0.5004, 0.5]]);
    expect(out[0]).toEqual([0, 0]);
    expect(out[out.length - 1]).toEqual([0.5004, 0.5]);
    expect(out.length).toBeLessThan(4);
  });

  it("caps the point count", () => {
    const pts = Array.from({ length: 2000 }, (_, i) => [i / 2000, (i % 7) / 7] as [number, number]);
    expect(simplifyStroke(pts, 0, 500)).toHaveLength(500);
  });
});

describe("parseCommentInput", () => {
  const base = { name: "Ana", email: "a@b.co", body: "Too dark", timestampSec: 4 };

  it("accepts a range after the start", () => {
    const r = parseCommentInput({ ...base, endSec: 6 });
    expect(r.ok && r.value.endSec).toBe(6);
  });

  it("rejects a range that does not end after it starts", () => {
    expect(parseCommentInput({ ...base, endSec: 4 })).toEqual({ ok: false, error: "bad_range" });
    expect(parseCommentInput({ ...base, endSec: 2 })).toEqual({ ok: false, error: "bad_range" });
  });

  it("strips range and drawing from replies and validates the parent id", () => {
    const r = parseCommentInput({
      ...base,
      parentId: "11111111-1111-4111-8111-111111111111",
      endSec: 9,
      annotation: { pin: { x: 0.5, y: 0.5 } },
    });
    expect(r.ok && r.value).toMatchObject({ endSec: null, annotation: null });
    expect(parseCommentInput({ ...base, parentId: "nope" })).toEqual({ ok: false, error: "bad_parent" });
  });

  it("passes annotation errors through", () => {
    expect(parseCommentInput({ ...base, annotation: { pin: { x: 3, y: 0 } } })).toEqual({
      ok: false,
      error: "bad_annotation",
    });
  });

  it("keeps the old required-field checks", () => {
    expect(parseCommentInput({ ...base, body: " " })).toEqual({ ok: false, error: "missing_fields" });
    expect(parseCommentInput({ ...base, email: "x" })).toEqual({ ok: false, error: "bad_email" });
  });
});
