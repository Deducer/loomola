import { parseAnnotation, type ReviewAnnotation } from "./annotation";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_COMMENT_BODY = 2000;

export type CommentInput = {
  name: string;
  email: string;
  body: string;
  timestampSec: number;
  endSec: number | null;
  annotation: ReviewAnnotation | null;
  parentId: string | null;
};

export type CommentInputError =
  | "missing_fields"
  | "bad_email"
  | "body_too_long"
  | "bad_range"
  | "bad_parent"
  | "annotation_too_large"
  | "bad_annotation";

/** Validate a share-page comment POST. Replies keep no range or drawing of
 *  their own (they display at the parent's time), so those are dropped. */
export function parseCommentInput(
  raw: unknown
): { ok: true; value: CommentInput } | { ok: false; error: CommentInputError } {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const name = str(b.name).slice(0, 120);
  const email = str(b.email);
  const body = str(b.body);
  if (!name || !body) return { ok: false, error: "missing_fields" };
  if (!EMAIL_RE.test(email)) return { ok: false, error: "bad_email" };
  if (body.length > MAX_COMMENT_BODY) return { ok: false, error: "body_too_long" };

  const ts = typeof b.timestampSec === "number" && Number.isFinite(b.timestampSec) ? b.timestampSec : 0;
  const timestampSec = Math.max(0, ts);

  let parentId: string | null = null;
  if (b.parentId !== undefined && b.parentId !== null) {
    if (typeof b.parentId !== "string" || !UUID_RE.test(b.parentId)) {
      return { ok: false, error: "bad_parent" };
    }
    parentId = b.parentId;
  }
  if (parentId) {
    return {
      ok: true,
      value: { name, email, body, timestampSec, endSec: null, annotation: null, parentId },
    };
  }

  let endSec: number | null = null;
  if (b.endSec !== undefined && b.endSec !== null) {
    if (typeof b.endSec !== "number" || !Number.isFinite(b.endSec) || b.endSec <= timestampSec) {
      return { ok: false, error: "bad_range" };
    }
    endSec = b.endSec;
  }

  const ann = parseAnnotation(b.annotation);
  if (!ann.ok) return { ok: false, error: ann.error };

  return {
    ok: true,
    value: { name, email, body, timestampSec, endSec, annotation: ann.annotation, parentId: null },
  };
}
