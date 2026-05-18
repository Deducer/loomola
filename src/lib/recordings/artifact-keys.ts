export function recordingObjectPrefix(key: string): string {
  const slash = key.lastIndexOf("/");
  return slash >= 0 ? key.slice(0, slash) : key;
}

export function compositeEditKey(baseCompositeKey: string, date = new Date()): string {
  return `${recordingObjectPrefix(baseCompositeKey)}/edits/composite-${date.getTime()}.mp4`;
}

export function playbackKeyForComposite(compositeKey: string): string {
  return `${recordingObjectPrefix(compositeKey)}/playback.mp4`;
}

export function thumbnailKeyForComposite(compositeKey: string): string {
  return `${recordingObjectPrefix(compositeKey)}/thumbnail.jpg`;
}

export function previewSpriteKeyForComposite(compositeKey: string): string {
  return `${recordingObjectPrefix(compositeKey)}/preview-sprite.jpg`;
}

export function videoExtensionForKey(key: string): "mp4" | "webm" {
  return key.toLowerCase().endsWith(".mp4") ? "mp4" : "webm";
}

export function extensionForKey(key: string, fallback: string): string {
  const last = key.split("/").pop() ?? "";
  const match = last.match(/\.([a-z0-9]+)$/i);
  return match?.[1]?.toLowerCase() ?? fallback;
}
