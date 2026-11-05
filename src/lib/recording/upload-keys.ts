import type { TrackKind } from "./types";

export function extensionForMime(mimeType: string): "webm" | "mp4" | "m4a" {
  const normalized = mimeType.toLowerCase();
  if (normalized.startsWith("video/mp4")) return "mp4";
  if (normalized.startsWith("audio/mp4")) return "m4a";
  return "webm";
}

/**
 * `segment` numbers a Resume-after-Stop segment (2, 3, ...). Segment 1 is
 * the plain key, so every existing note's keys are unchanged. Segment keys
 * stay under `<slug>/raw/` so recordingPrefixFromTrackKey still finds the
 * note's prefix for mixed.m4a and activity.bin.
 */
export function keyForTrack(
  slug: string,
  kind: TrackKind,
  mimeType: string,
  segment: number = 1
): string {
  const segmentSuffix = segment > 1 ? `-seg${segment}` : "";
  const suffix = kind === "composite" ? "composite" : `raw/${kind}${segmentSuffix}`;
  return `${slug}/${suffix}.${extensionForMime(mimeType)}`;
}
