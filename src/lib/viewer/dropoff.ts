/**
 * Buckets a list of per-viewer `max_watched_sec` values into `bucketCount`
 * equal-width bins covering `[0, durationSec]`. Viewers who exceed the
 * duration clamp to the last bucket. Returns an array of counts with length
 * `bucketCount`.
 */
export function bucketize(
  maxWatchedPerViewer: number[],
  durationSec: number,
  bucketCount = 10
): number[] {
  const buckets = new Array<number>(bucketCount).fill(0);
  if (durationSec <= 0) return buckets;
  const width = durationSec / bucketCount;
  for (const max of maxWatchedPerViewer) {
    const raw = Math.floor(max / width);
    const idx = Math.max(0, Math.min(bucketCount - 1, raw));
    buckets[idx] += 1;
  }
  return buckets;
}
