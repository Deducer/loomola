import type { WordTimestamp } from "@/db/queries/transcripts";

const TIE_MARGIN = 0.05;

/**
 * Picks the speaker_idx most likely to be the user (the host) based on
 * total speech duration. Returns null when:
 *   - no words have speaker info
 *   - the top two speakers are within TIE_MARGIN of each other (5%)
 *
 * The 5% tie threshold avoids confidently picking a "host" in
 * meetings where speech is roughly balanced — better to say nothing
 * than auto-label the wrong person.
 */
export function detectSelfSpeakerIdx(
  words: ReadonlyArray<WordTimestamp>
): number | null {
  const totals = new Map<number, number>();
  for (const w of words) {
    if (typeof w.speaker !== "number") continue;
    const dur = w.end - w.start;
    if (!(dur > 0)) continue;
    totals.set(w.speaker, (totals.get(w.speaker) ?? 0) + dur);
  }

  if (totals.size === 0) return null;

  let topIdx: number | null = null;
  let topVal = 0;
  let secondVal = 0;
  for (const [idx, val] of totals.entries()) {
    if (val > topVal) {
      secondVal = topVal;
      topVal = val;
      topIdx = idx;
    } else if (val > secondVal) {
      secondVal = val;
    }
  }

  if (topIdx === null) return null;
  if (totals.size === 1) return topIdx;

  // Tie threshold: top must beat second by > TIE_MARGIN of the top.
  if (topVal === 0) return null;
  if ((topVal - secondVal) / topVal <= TIE_MARGIN) return null;

  return topIdx;
}
