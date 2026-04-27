import type { TrackKind } from "./types";

export function extensionForMime(mimeType: string): "webm" | "mp4" | "m4a" {
  const normalized = mimeType.toLowerCase();
  if (normalized.startsWith("video/mp4")) return "mp4";
  if (normalized.startsWith("audio/mp4")) return "m4a";
  return "webm";
}

export function keyForTrack(
  slug: string,
  kind: TrackKind,
  mimeType: string
): string {
  const suffix = kind === "composite" ? "composite" : `raw/${kind}`;
  return `${slug}/${suffix}.${extensionForMime(mimeType)}`;
}
