import { ANNOTATION_COLORS, type ReviewAnnotation } from "@/lib/review/annotation";
import type { DrawTool } from "./annotation-overlay";

export type AnnotationColor = (typeof ANNOTATION_COLORS)[number];

/** The comment being composed: where it sits in time and what's drawn. */
export type ReviewDraft = {
  /** Frame the comment (and drawing) belongs to; null = follow the playhead. */
  anchorSec: number | null;
  endSec: number | null;
  annotation: ReviewAnnotation;
  tool: DrawTool | null;
  color: AnnotationColor;
};

export const EMPTY_DRAFT: ReviewDraft = {
  anchorSec: null,
  endSec: null,
  annotation: {},
  tool: null,
  color: ANNOTATION_COLORS[0],
};

const IDENTITY_KEY = "loomola.commenter";

export type CommenterIdentity = { name: string; email: string };

/** Name/email from the visitor's last comment (this browser only). */
export function loadIdentity(): CommenterIdentity | null {
  try {
    const raw = window.localStorage.getItem(IDENTITY_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<CommenterIdentity>;
    return typeof v.name === "string" && typeof v.email === "string" ? { name: v.name, email: v.email } : null;
  } catch {
    return null;
  }
}

export function saveIdentity(identity: CommenterIdentity): void {
  try {
    window.localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity));
  } catch {
    // private mode etc.: the form just asks again next time
  }
}

export function commentErrorMessage(status: number, error: string | undefined, retryAfterSec?: number): string {
  if (status === 429) return `Slow down — try again in ${retryAfterSec ?? 60}s.`;
  if (status === 403) return "This recording is locked. Unlock it first.";
  switch (error) {
    case "bad_email":
      return "That email looks invalid.";
    case "body_too_long":
      return "Comment too long (max 2000 chars).";
    case "bad_range":
      return "The range must end after it starts.";
    case "bad_annotation":
    case "annotation_too_large":
      return "That drawing couldn't be saved. Try fewer strokes.";
    case "bad_parent":
      return "That thread no longer exists.";
    case "missing_fields":
      return "Please fill in all fields.";
    default:
      return `Unexpected error (${status}).`;
  }
}
