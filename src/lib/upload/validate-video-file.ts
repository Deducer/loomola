/**
 * Pure validation for "Upload video" on the dashboard. Kept free of DOM so it
 * can be unit-tested; the browser-only bits (duration probe, object URLs)
 * live in `read-video-duration.ts`.
 */

export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024; // 2 GiB

/** MIME types the pipeline accepts for the composite track. mp4 covers mov
 *  and m4v because R2 keys and ffmpeg treat them the same (`extensionForMime`
 *  maps anything `video/mp4*` to `.mp4`). */
const EXTENSION_MIME: Record<string, "video/mp4" | "video/webm"> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/mp4",
  webm: "video/webm",
};

export type FileLike = { name: string; size: number; type: string };

export type ValidateResult =
  | { ok: true; mimeType: "video/mp4" | "video/webm"; title: string }
  | { ok: false; reason: string };

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

/** Strip the extension for a default title; falls back to "Untitled". */
export function titleFromFileName(name: string): string {
  const dot = name.lastIndexOf(".");
  const base = (dot > 0 ? name.slice(0, dot) : name).trim();
  return base || "Untitled";
}

export function validateVideoFile(file: FileLike): ValidateResult {
  const ext = extensionOf(file.name);
  const byExtension = EXTENSION_MIME[ext];
  const browserType = file.type.toLowerCase();

  // Prefer the extension: Finder-renamed files and some mov exports report an
  // empty or generic browser MIME type, and the extension is what R2 keys on.
  const mimeType =
    byExtension ??
    (browserType.startsWith("video/mp4")
      ? "video/mp4"
      : browserType.startsWith("video/webm")
        ? "video/webm"
        : null);

  if (!mimeType) {
    return {
      ok: false,
      reason: "Only MP4, MOV, M4V or WebM videos can be uploaded.",
    };
  }
  if (file.size <= 0) {
    return { ok: false, reason: "That file is empty." };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, reason: "Videos must be 2 GB or smaller." };
  }
  return { ok: true, mimeType, title: titleFromFileName(file.name) };
}

/** Pick the single video out of a drop, or explain why there is none. */
export function pickDroppedVideo(files: FileLike[]): ValidateResult {
  if (files.length === 0) {
    return { ok: false, reason: "Drop a video file." };
  }
  if (files.length > 1) {
    return { ok: false, reason: "Drop one video at a time." };
  }
  return validateVideoFile(files[0]);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
