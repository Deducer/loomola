import { z } from "zod";
import type { WordTimestamp } from "@/db/queries/transcripts";

/**
 * Transcript-content speaker attribution (Stage 17). People address each
 * other by name constantly — "Thanks, Ann", "Bhaskar, what do you
 * think?" — so an LLM pass over the diarized transcript can map voices
 * to attendees with actual evidence, unlike the positional G-M13 v1
 * mapping.
 *
 * The design law is NEVER MISATTRIBUTE: every attribution must carry a
 * verbatim evidence quote, and `verifyAttributions` rejects anything
 * whose quote doesn't literally appear in the transcript, whose name
 * isn't a real attendee, that conflicts with another attribution, or
 * that isn't high-confidence. Rejected speakers stay unlabeled and fall
 * back to the manual "who is this?" picker.
 */

export type SpeakerUtterance = {
  speakerIdx: number;
  startSec: number;
  text: string;
};

export const speakerAttributionSchema = z.object({
  attributions: z
    .array(
      z.object({
        speakerIdx: z.number().int().min(0),
        attendeeName: z
          .string()
          .nullable()
          .describe("EXACT name from the attendee list, or null when evidence is insufficient."),
        confidence: z.enum(["high", "medium", "low"]),
        evidence: z
          .string()
          .max(300)
          .describe("Verbatim transcript snippet proving the mapping. Will be checked literally — paraphrasing invalidates the attribution."),
      })
    )
    .max(32),
});

export type RawAttribution = z.infer<typeof speakerAttributionSchema>["attributions"][number];

export type VerifiedAttribution = {
  speakerIdx: number;
  attendeeName: string;
  evidence: string;
};

/** Group word timestamps into consecutive same-speaker utterances. */
export function buildSpeakerUtterances(
  words: ReadonlyArray<WordTimestamp>
): SpeakerUtterance[] {
  const utterances: SpeakerUtterance[] = [];
  let current: { speakerIdx: number; startSec: number; parts: string[] } | null = null;
  for (const w of words) {
    if (typeof w.speaker !== "number") continue;
    if (current && current.speakerIdx === w.speaker) {
      current.parts.push(w.word);
      continue;
    }
    if (current) {
      utterances.push({
        speakerIdx: current.speakerIdx,
        startSec: current.startSec,
        text: current.parts.join(" "),
      });
    }
    current = { speakerIdx: w.speaker, startSec: w.start, parts: [w.word] };
  }
  if (current) {
    utterances.push({
      speakerIdx: current.speakerIdx,
      startSec: current.startSec,
      text: current.parts.join(" "),
    });
  }
  return utterances;
}

/**
 * Renders the transcript the LLM sees. When it exceeds `maxChars`, keeps
 * the head plus every utterance that mentions an attendee name token —
 * with one utterance of context on each side, since "Thanks, Ann" is
 * evidence about the NEIGHBORING turn — trimmed chronologically to fit.
 */
export function buildAttributionTranscript(params: {
  utterances: ReadonlyArray<SpeakerUtterance>;
  attendeeNames: ReadonlyArray<string>;
  maxChars?: number;
}): string {
  const maxChars = params.maxChars ?? 150_000;
  const render = (u: SpeakerUtterance) =>
    `[Speaker ${u.speakerIdx + 1} @ ${formatTs(u.startSec)}] ${u.text}`;

  const full = params.utterances.map(render).join("\n");
  if (full.length <= maxChars) return full;

  const nameTokens = params.attendeeNames
    .flatMap((name) => name.split(/\s+/))
    .map((token) => token.toLowerCase())
    .filter((token) => token.length >= 3);

  const keep = new Set<number>();
  // Head: openings carry introductions.
  for (let i = 0; i < Math.min(40, params.utterances.length); i++) keep.add(i);
  params.utterances.forEach((u, i) => {
    const lower = u.text.toLowerCase();
    if (nameTokens.some((token) => lower.includes(token))) {
      keep.add(i - 1);
      keep.add(i);
      keep.add(i + 1);
    }
  });

  const indices = Array.from(keep)
    .filter((i) => i >= 0 && i < params.utterances.length)
    .sort((a, b) => a - b);

  const lines: string[] = [];
  let total = 0;
  let previous = -1;
  for (const i of indices) {
    const line = (previous >= 0 && i > previous + 1 ? "[…]\n" : "") + render(params.utterances[i]);
    if (total + line.length > maxChars) break;
    lines.push(line);
    total += line.length + 1;
    previous = i;
  }
  return lines.join("\n");
}

export function buildAttributionPrompt(params: {
  attendeeNames: ReadonlyArray<string>;
  selfName: string | null;
  speakerIdxs: ReadonlyArray<number>;
  transcript: string;
}): string {
  const attendeeLines = params.attendeeNames.map((name) => `- ${name}`);
  if (params.selfName) {
    attendeeLines.push(`- ${params.selfName} (the note owner)`);
  }
  return [
    "You identify which meeting attendee each diarized speaker is, using ONLY direct textual evidence from the transcript.",
    "",
    "Attendees:",
    ...attendeeLines,
    "",
    `Speakers to identify: ${params.speakerIdxs.map((i) => `Speaker ${i + 1}`).join(", ")}. speakerIdx in your output is ZERO-based (Speaker 1 → speakerIdx 0).`,
    "",
    "Evidence that counts:",
    "- A speaker introduces themself: \"Hi, this is Bhaskar\" said BY that speaker.",
    "- Direct address then response: \"What do you think, Ann?\" followed by a different speaker answering — the responder is Ann, IF the turn structure is unambiguous.",
    "- A speaker is thanked or named immediately after finishing: \"Thanks, Neely\" right after Speaker 4's turn → Speaker 4 is Neely.",
    "- An unambiguous third-person reference that pins a specific voice to a name.",
    "",
    "Hard rules:",
    "- NEVER infer from speaking order, role, topic, or amount of speech. When evidence is indirect, ambiguous, or absent, output attendeeName null with confidence \"low\" for that speaker.",
    "- Automatic transcription misspells names; a similar-sounding name IS the attendee (\"Anne\"→\"Ann\", \"Bosco\"→\"Bhaskar\"), but attendeeName must be the EXACT spelling from the attendee list.",
    "- evidence must be copied VERBATIM from the transcript (≤300 chars, the utterance text only, without the [Speaker N @ time] prefix). It is checked literally against the transcript; any paraphrase invalidates the attribution.",
    "- confidence \"high\" ONLY when exactly one reading of the evidence is possible.",
    "- One attendee cannot be two different speakers; if evidence points both ways, mark both null.",
    "",
    "Transcript (speaker-labeled):",
    params.transcript,
  ].join("\n");
}

function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The never-misattribute gate. Keeps an attribution only when ALL hold:
 *   - confidence is "high"
 *   - the speakerIdx was actually asked about
 *   - attendeeName exactly matches a provided attendee (case-insensitive)
 *   - the evidence quote literally appears in the transcript (normalized
 *     for casing/punctuation/whitespace) and is ≥ 12 normalized chars
 *   - no attendee is claimed by two speakers, and no speaker gets two
 *     names (conflicts drop ALL parties involved)
 */
export function verifyAttributions(params: {
  raw: ReadonlyArray<RawAttribution>;
  attendeeNames: ReadonlyArray<string>;
  speakerIdxs: ReadonlyArray<number>;
  transcriptText: string;
}): VerifiedAttribution[] {
  const askedIdxs = new Set(params.speakerIdxs);
  const canonicalByLower = new Map(
    params.attendeeNames.map((name) => [name.toLowerCase(), name])
  );
  const normalizedTranscript = normalizeForMatch(params.transcriptText);

  const candidates: VerifiedAttribution[] = [];
  for (const attribution of params.raw) {
    if (attribution.confidence !== "high") continue;
    if (!attribution.attendeeName) continue;
    if (!askedIdxs.has(attribution.speakerIdx)) continue;
    const canonical = canonicalByLower.get(attribution.attendeeName.toLowerCase());
    if (!canonical) continue;
    const evidence = normalizeForMatch(attribution.evidence);
    if (evidence.length < 12) continue;
    if (!normalizedTranscript.includes(evidence)) continue;
    candidates.push({
      speakerIdx: attribution.speakerIdx,
      attendeeName: canonical,
      evidence: attribution.evidence.trim(),
    });
  }

  // Conflicts drop every involved party — a coin-flip between two
  // mappings is exactly the misattribution risk this gate exists for.
  const speakerCounts = new Map<number, number>();
  const nameCounts = new Map<string, number>();
  for (const c of candidates) {
    speakerCounts.set(c.speakerIdx, (speakerCounts.get(c.speakerIdx) ?? 0) + 1);
    nameCounts.set(c.attendeeName, (nameCounts.get(c.attendeeName) ?? 0) + 1);
  }
  return candidates.filter(
    (c) =>
      speakerCounts.get(c.speakerIdx) === 1 && nameCounts.get(c.attendeeName) === 1
  );
}

function formatTs(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toString().padStart(2, "0")}`;
}
