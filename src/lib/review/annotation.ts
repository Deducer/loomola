import { z } from "zod";

/**
 * A pin and/or drawing on one video frame. Every coordinate is a fraction
 * (0-1) of the displayed video frame, not the player box, so marks line up
 * at any player size or aspect ratio (letterbox bars excluded; see
 * content-box.ts). Validated on every write: colours come from a fixed
 * palette so stored data can never carry arbitrary CSS.
 */
export const ANNOTATION_COLORS = [
  "#FF4D4F",
  "#FFC53D",
  "#73D13D",
  "#40A9FF",
  "#FFFFFF",
] as const;

export const ANNOTATION_TOOLS = ["pen", "arrow", "rect"] as const;
export type AnnotationTool = (typeof ANNOTATION_TOOLS)[number];

export const MAX_STROKES = 20;
export const MAX_POINTS_PER_STROKE = 500;
export const MAX_ANNOTATION_BYTES = 16 * 1024;
export const DEFAULT_STROKE_WIDTH = 0.004;

const fraction = z.number().finite().min(0).max(1);
const point = z.tuple([fraction, fraction]);

const strokeSchema = z
  .object({
    tool: z.enum(ANNOTATION_TOOLS),
    color: z.enum(ANNOTATION_COLORS),
    width: z.number().finite().min(0.001).max(0.03),
    points: z.array(point).min(1).max(MAX_POINTS_PER_STROKE),
  })
  .strict()
  .refine((s) => s.tool === "pen" || s.points.length === 2, {
    message: "arrow and rect strokes take exactly two points",
  });

export const annotationSchema = z
  .object({
    pin: z.object({ x: fraction, y: fraction }).strict().optional(),
    strokes: z.array(strokeSchema).max(MAX_STROKES).optional(),
  })
  .strict();

export type ReviewAnnotation = z.infer<typeof annotationSchema>;
export type AnnotationStroke = NonNullable<ReviewAnnotation["strokes"]>[number];

export function isEmptyAnnotation(a: ReviewAnnotation | null | undefined): boolean {
  return !a || (!a.pin && (a.strokes?.length ?? 0) === 0);
}

export type ParsedAnnotation =
  | { ok: true; annotation: ReviewAnnotation | null }
  | { ok: false; error: "annotation_too_large" | "bad_annotation" };

/** Validate untrusted input. Empty or absent → null (no annotation). */
export function parseAnnotation(raw: unknown): ParsedAnnotation {
  if (raw === undefined || raw === null) return { ok: true, annotation: null };
  let size: number;
  try {
    size = JSON.stringify(raw).length;
  } catch {
    return { ok: false, error: "bad_annotation" };
  }
  if (size > MAX_ANNOTATION_BYTES) return { ok: false, error: "annotation_too_large" };
  const parsed = annotationSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "bad_annotation" };
  const a = parsed.data;
  if (isEmptyAnnotation(a)) return { ok: true, annotation: null };
  return {
    ok: true,
    annotation: {
      ...(a.pin ? { pin: a.pin } : {}),
      ...(a.strokes?.length ? { strokes: a.strokes } : {}),
    },
  };
}

/** Keep a pen stroke small: drop points closer than `minDist` to the last
 *  kept one, round to 4 decimals, and cap the count (evenly thinned). */
export function simplifyStroke(
  points: Array<[number, number]>,
  minDist = 0.002,
  cap = MAX_POINTS_PER_STROKE
): Array<[number, number]> {
  const round = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 1e4) / 1e4;
  const kept: Array<[number, number]> = [];
  for (const [x, y] of points) {
    const p: [number, number] = [round(x), round(y)];
    const last = kept[kept.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) >= minDist) kept.push(p);
  }
  const end = points[points.length - 1];
  if (end && kept.length > 1) kept[kept.length - 1] = [round(end[0]), round(end[1])];
  if (kept.length <= cap) return kept;
  const out: Array<[number, number]> = [];
  const step = (kept.length - 1) / (cap - 1);
  for (let i = 0; i < cap; i++) out.push(kept[Math.round(i * step)]);
  return out;
}
