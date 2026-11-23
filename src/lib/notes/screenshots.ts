import type { WordTimestamp } from "@/db/queries/transcripts";

/** note_attachments.kind for frames the desktop app saves from the meeting window. */
export const SCREENSHOT_KIND = "screenshot";

/** The desktop app stops at 40; this is the server's ceiling for one note. */
export const MAX_SCREENSHOTS_PER_NOTE = 60;

const MAX_OFFSET_MS = 24 * 60 * 60 * 1000;

export type ScreenshotUpload =
  | { ok: true; kind: "image" }
  | { ok: true; kind: "screenshot"; offsetMs: number }
  | { ok: false; error: "invalid_kind" | "invalid_offset" };

/**
 * Reads the optional `kind` / `offsetMs` form fields of an attachment upload.
 * Builds from before screenshots send neither and are plain images.
 */
export function parseScreenshotUpload(
  kind: FormDataEntryValue | null,
  offsetMs: FormDataEntryValue | null
): ScreenshotUpload {
  if (kind === null || kind === "image") return { ok: true, kind: "image" };
  if (kind !== SCREENSHOT_KIND) return { ok: false, error: "invalid_kind" };
  // Digits only: Number("") is 0, which would quietly pass.
  const parsed =
    typeof offsetMs === "string" && /^\d{1,9}$/.test(offsetMs)
      ? Number(offsetMs)
      : NaN;
  if (!Number.isInteger(parsed) || parsed > MAX_OFFSET_MS) {
    return { ok: false, error: "invalid_offset" };
  }
  return { ok: true, kind: "screenshot", offsetMs: parsed };
}

/** "4:07" or "1:02:09". */
export function formatScreenshotOffset(offsetMs: number): string {
  const total = Math.max(0, Math.floor(offsetMs / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = (total % 60).toString().padStart(2, "0");
  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, "0")}:${seconds}`
    : `${minutes}:${seconds}`;
}

const SPOKEN_WINDOW_BEFORE_SEC = 2;
const SPOKEN_WINDOW_AFTER_SEC = 12;
const SPOKEN_MAX_WORDS = 28;

/**
 * The words spoken just after a screenshot was taken. The notes prompt gets
 * the transcript as plain text with no times, so this quote is what lets the
 * model find where in the conversation a screenshot belongs.
 */
export function spokenNear(
  words: WordTimestamp[],
  offsetMs: number
): string | null {
  if (words.length === 0) return null;
  const at = offsetMs / 1000;
  const nearby = words
    .filter(
      (word) =>
        word.start >= at - SPOKEN_WINDOW_BEFORE_SEC &&
        word.start <= at + SPOKEN_WINDOW_AFTER_SEC
    )
    .slice(0, SPOKEN_MAX_WORDS)
    .map((word) => word.word.trim())
    .filter(Boolean);
  return nearby.length >= 3 ? nearby.join(" ") : null;
}

export type ScreenshotForPrompt = {
  offsetMs: number;
  description: string;
  spokenNearby: string | null;
};

/**
 * Screenshot rows → prompt entries, oldest first. Rows with no description
 * yet, or an empty one (the model saw no shared content), are left out.
 */
export function screenshotsForPrompt(
  rows: Array<{ kind: string; offsetMs: number | null; description: string | null }>,
  /** transcripts.word_timestamps as stored (jsonb). */
  wordTimestamps: unknown
): ScreenshotForPrompt[] {
  const words = Array.isArray(wordTimestamps)
    ? (wordTimestamps as WordTimestamp[]).filter(
        (word) => typeof word?.word === "string" && typeof word?.start === "number"
      )
    : [];
  return rows
    .filter(
      (row) =>
        row.kind === SCREENSHOT_KIND &&
        row.offsetMs !== null &&
        !!row.description?.trim()
    )
    .map((row) => ({
      offsetMs: row.offsetMs as number,
      description: (row.description as string).trim(),
      spokenNearby: spokenNear(words, row.offsetMs as number),
    }))
    .sort((a, b) => a.offsetMs - b.offsetMs);
}

export function screenshotPromptLines(
  screenshots: ScreenshotForPrompt[]
): string[] {
  return screenshots.map((shot) => {
    const said = shot.spokenNearby
      ? ` (said around then: "${shot.spokenNearby}")`
      : "";
    return `- [${formatScreenshotOffset(shot.offsetMs)}] ${shot.description}${said}`;
  });
}
