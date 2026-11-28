/** Frame maths for the review player. `fps` null = unknown (the page then
 *  shows m:ss and steps at FALLBACK_FPS). */
export const FALLBACK_FPS = 30;

export function effectiveFps(fps: number | null | undefined): number {
  return fps && Number.isFinite(fps) && fps > 0 ? fps : FALLBACK_FPS;
}

/** Accept only plausible probed rates; ffprobe reports 1000/1 for some
 *  MediaRecorder webms, which would make "frame" stepping meaningless. */
export function sanitizeFps(raw: number | null | undefined): number | null {
  if (raw == null || !Number.isFinite(raw)) return null;
  if (raw < 1 || raw > 120) return null;
  return Math.round(raw * 1000) / 1000;
}

/** "30000/1001" → 29.97. */
export function parseFrameRate(rate: string | null | undefined): number | null {
  if (!rate) return null;
  const [n, d] = rate.split("/").map(Number);
  const value = d === undefined ? n : d === 0 ? NaN : n / d;
  return sanitizeFps(value);
}

export function frameIndex(t: number, fps: number): number {
  // The epsilon keeps t = 2/fps (stored as 0.0666…) on frame 2, not 1.
  return Math.max(0, Math.floor(t * fps + 1e-6));
}

/** Middle of the frame containing `t`: seeking there always shows that
 *  frame, never its neighbour (browsers round seeks either way). */
export function snapToFrame(t: number, fps: number): number {
  return (frameIndex(t, fps) + 0.5) / fps;
}

export function stepFrame(t: number, fps: number, dir: 1 | -1, duration?: number): number {
  const next = (Math.max(0, frameIndex(t, fps) + dir) + 0.5) / fps;
  if (duration && Number.isFinite(duration) && duration > 0) {
    return Math.min(next, Math.max(0, duration - 0.5 / fps));
  }
  return next;
}

/** "1:02" without fps; "1:02:07" (minutes:seconds:frames) with it; hours
 *  prefix past an hour. */
export function formatTimecode(t: number, fps: number | null | undefined): string {
  const known = fps && Number.isFinite(fps) && fps > 0 ? fps : null;
  const safe = Math.max(0, t);
  const totalSec = known ? Math.floor(frameIndex(safe, known) / known + 1e-9) : Math.floor(safe);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const base = h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
  if (!known) return base;
  // Frames since the first frame of this second (ceil: at 29.97 the second
  // starts mid-frame), so ff runs 0..ceil(fps)-1 and never repeats.
  const ff = frameIndex(safe, known) - Math.ceil(totalSec * known - 1e-9);
  return `${base}:${String(Math.max(0, ff)).padStart(2, "0")}`;
}
