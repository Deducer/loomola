import { describe, expect, it } from "vitest";
import {
  annotationAnchor,
  buildThreads,
  filterThreads,
  flattenThreads,
  threadsNearTime,
  type ReviewComment,
} from "@/lib/review/comments";

function c(id: string, t: number, extra: Partial<ReviewComment> = {}): ReviewComment {
  return {
    id,
    commenterName: "A",
    body: id,
    timestampSec: t,
    endSec: null,
    annotation: null,
    parentId: null,
    resolvedAt: null,
    createdAt: `2026-11-28T10:00:0${id.length}Z`,
    ...extra,
  };
}

describe("buildThreads", () => {
  it("numbers top-level comments by time and nests replies", () => {
    const threads = buildThreads([
      c("b", 10),
      c("a", 2),
      c("r1", 10, { parentId: "b", createdAt: "2026-11-28T11:00:00Z" }),
      c("r0", 10, { parentId: "b", createdAt: "2026-11-28T10:30:00Z" }),
      c("orphan", 1, { parentId: "gone" }),
    ]);
    expect(threads.map((t) => [t.id, t.number])).toEqual([["a", 1], ["b", 2]]);
    expect(threads[1].replies.map((r) => r.id)).toEqual(["r0", "r1"]);
    expect(flattenThreads(threads).map((x) => x.id).sort()).toEqual(["a", "b", "r0", "r1"]);
  });

  it("keeps numbers stable across filters", () => {
    const threads = buildThreads([c("a", 1), c("b", 2, { resolvedAt: "2026-11-28T12:00:00Z" }), c("cc", 3)]);
    expect(filterThreads(threads, "open").map((t) => t.number)).toEqual([1, 3]);
    expect(filterThreads(threads, "resolved").map((t) => t.number)).toEqual([2]);
  });
});

describe("threadsNearTime", () => {
  const pin = { pin: { x: 0.1, y: 0.2 } };
  const threads = buildThreads([
    c("a", 5, { annotation: pin }),
    c("b", 20, { annotation: pin, endSec: 30 }),
    c("cc", 5.2),
    c("d", 5.1, { annotation: pin, resolvedAt: "2026-11-28T12:00:00Z" }),
  ]);
  it("shows annotated, open comments within half a second or inside their range", () => {
    expect(threadsNearTime(threads, 5.4).map((t) => t.id)).toEqual(["a"]);
    expect(threadsNearTime(threads, 25).map((t) => t.id)).toEqual(["b"]);
    expect(threadsNearTime(threads, 6)).toEqual([]);
  });
});

describe("annotationAnchor", () => {
  it("prefers the pin, else the first stroke point", () => {
    expect(annotationAnchor({ pin: { x: 0.3, y: 0.4 } })).toEqual({ x: 0.3, y: 0.4 });
    expect(
      annotationAnchor({ strokes: [{ tool: "rect", color: "#FFFFFF", width: 0.004, points: [[0.1, 0.2], [0.5, 0.6]] }] })
    ).toEqual({ x: 0.1, y: 0.2 });
    expect(annotationAnchor(null)).toBeNull();
  });
});
