// Pure transform helpers for the Granola → Loomola import endpoint.
// Spec: docs/superpowers/specs/2026-05-06-granola-migration-tool-design.md
//
// Everything in this file is a pure function: deterministic, no side
// effects, no DB. Unit-tested in tests/unit/granola-import-transform.test.ts.

import { createHash } from "node:crypto";

type Segment = {
  granolaPersonId: string | null;
  text: string;
  startMs: number;
  endMs: number;
};

export type SpeakerIndexMap = Record<string, number>;

export type DeepgramParagraph = {
  speaker: number | null;
  start: number;
  end: number;
  text: string;
};

/**
 * Map each Granola person UUID to a Loomola speaker_idx (0, 1, 2, …)
 * in first-appearance order across the segment list. Null speakers are
 * preserved as null in segment normalization but excluded from the map.
 */
export function assignSpeakerIndices(segments: Segment[]): SpeakerIndexMap {
  const map: SpeakerIndexMap = {};
  let nextIdx = 0;
  for (const s of segments) {
    if (s.granolaPersonId === null) continue;
    if (!(s.granolaPersonId in map)) {
      map[s.granolaPersonId] = nextIdx++;
    }
  }
  return map;
}

/**
 * Granola gives us segment-level speaker-attributed text. Loomola's
 * transcript renderer was built for Deepgram paragraphs (one paragraph
 * per speaker turn). Merge consecutive same-speaker segments into
 * paragraphs. Times are converted from ms to seconds.
 */
export function normalizeSegmentsToParagraphs(
  segments: Segment[],
  speakerMap: SpeakerIndexMap
): DeepgramParagraph[] {
  if (segments.length === 0) return [];
  const out: DeepgramParagraph[] = [];
  let current: DeepgramParagraph | null = null;
  for (const s of segments) {
    const speaker =
      s.granolaPersonId === null
        ? null
        : speakerMap[s.granolaPersonId] ?? null;
    if (current && current.speaker === speaker) {
      current.end = s.endMs / 1000;
      current.text = `${current.text} ${s.text}`.trim();
    } else {
      if (current) out.push(current);
      current = {
        speaker,
        start: s.startMs / 1000,
        end: s.endMs / 1000,
        text: s.text,
      };
    }
  }
  if (current) out.push(current);
  return out;
}

/**
 * Stable, URL-safe slug for an imported note. Deterministic for a given
 * (title, granolaId) pair so re-runs don't churn slugs. Suffix is the
 * first 6 hex chars of sha256(granolaId), guaranteeing uniqueness across
 * notes that happen to share the same title.
 */
export function buildImportSlug(title: string, granolaId: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60);
  const suffix = createHash("sha256")
    .update(granolaId)
    .digest("hex")
    .slice(0, 6);
  const root = base.length > 0 ? base : "granola-import";
  return `${root}-${suffix}`;
}

/**
 * Identify the meeting platform from a meeting URL so the dashboard
 * can show the right icon (zoom / meet / teams). Returns null for
 * unknown hosts and malformed URLs.
 */
export function detectMeetingApp(url: string | null): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname;
    if (host.endsWith("zoom.us")) return "zoom";
    if (host === "meet.google.com") return "meet";
    if (host.endsWith("teams.microsoft.com")) return "teams";
    return null;
  } catch {
    return null;
  }
}
