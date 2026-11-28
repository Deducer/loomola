/**
 * Version stacks: rows sharing version_group_id are drafts of one piece.
 * version_number is only an order key (gaps after a removal are normal),
 * so everything a person sees ("v3", ?v=3) is the 1-based position among
 * the live versions, from orderVersions.
 */
export type VersionLike = {
  id: string;
  versionNumber: number | null;
  createdAt: Date | string;
};

export function orderVersions<T extends VersionLike>(rows: T[]): T[] {
  const time = (r: VersionLike) => new Date(r.createdAt).getTime();
  return [...rows].sort((a, b) => {
    const an = a.versionNumber ?? Number.POSITIVE_INFINITY;
    const bn = b.versionNumber ?? Number.POSITIVE_INFINITY;
    return an - bn || time(a) - time(b) || a.id.localeCompare(b.id);
  });
}

/** 1-based position of `id` in the ordered stack (1 when not stacked). */
export function versionPosition(ordered: VersionLike[], id: string): number {
  const i = ordered.findIndex((v) => v.id === id);
  return i < 0 ? 1 : i + 1;
}

/** Move one id up (-1) or down (+1); out-of-range moves are no-ops. */
export function moveVersion(ids: string[], id: string, dir: -1 | 1): string[] {
  const i = ids.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return ids;
  const next = [...ids];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** True when `proposed` is exactly a permutation of `current`. */
export function isPermutation(current: string[], proposed: string[]): boolean {
  if (current.length !== proposed.length) return false;
  const a = [...current].sort();
  const b = [...proposed].sort();
  return a.every((v, i) => v === b[i]) && new Set(proposed).size === proposed.length;
}

/** Default compare pair as positions: the previous version on the left and
 *  this one on the right; from v1, v1 against v2. Null for a stack of one. */
export function compareDefaults(count: number, current: number): { left: number; right: number } | null {
  if (count < 2) return null;
  const right = Math.min(Math.max(current, 2), count);
  return { left: right === current ? current - 1 : 1, right };
}

/** "Hero cut v2" → "Hero cut"; used to title a new version "Hero cut v3". */
export function baseTitle(title: string | null | undefined): string {
  return (title ?? "").replace(/\s+v\d+$/i, "").trim();
}

export const DRIFT_SEEK_SEC = 0.25;

/**
 * Keep a compare follower within a frame of the reference player. A seek on
 * a playing video lands on a keyframe and rebuffers, so small drift is
 * closed by nudging playbackRate (up to 10% for a second or so) and only
 * drift past DRIFT_SEEK_SEC seeks. Within a frame: normal speed.
 */
export function driftCorrection(
  reference: number,
  follower: number,
  fps: number
): { seekTo: number | null; rate: number } {
  const frame = 1 / (fps > 0 ? fps : 30);
  const behind = reference - follower;
  if (Math.abs(behind) > DRIFT_SEEK_SEC) return { seekTo: reference, rate: 1 };
  if (Math.abs(behind) <= frame) return { seekTo: null, rate: 1 };
  const nudge = Math.max(-0.1, Math.min(0.1, behind * 0.5));
  return { seekTo: null, rate: Math.round((1 + nudge) * 1000) / 1000 };
}
