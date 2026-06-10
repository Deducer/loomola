import type { NormalizedTranscript, TranscriptWord } from "./types";

export type WhisperSegment = {
  start: number;
  end: number;
  text: string;
};

/** Subset of OpenAI's verbose_json transcription response we consume. */
export type WhisperVerboseResponse = {
  task?: string;
  language?: string;
  duration?: number;
  text?: string;
  segments?: WhisperSegment[];
};

/** Whisper has no diarization: every word is attributed to speaker 0. */
export const WHISPER_SPEAKER = 0;

/**
 * Maps verbose_json segment timestamps onto the repo's transcript shape
 * (a punctuated word timeline). Word timings are linearly interpolated
 * inside each segment, deliberately NOT taken from whisper's word-level
 * granularity: those word entries strip punctuation, and the transcript
 * panel (groupWordsIntoParagraphs) renders the word array directly —
 * punctuated interpolated words beat precise unpunctuated ones. Seek
 * precision degrades to ~segment-interpolation; paragraphing, SRT export,
 * chapters, and dictionary rewrite are unaffected.
 */
export function normalizeWhisperTranscript(
  body: WhisperVerboseResponse
): NormalizedTranscript {
  const real = (body.segments ?? [])
    .filter((segment) => segment.text.trim().length > 0)
    .sort((a, b) => a.start - b.start);

  const segments: WhisperSegment[] =
    real.length === 0 && body.text?.trim()
      ? [{ start: 0, end: body.duration ?? 0, text: body.text }]
      : real;

  const words: TranscriptWord[] = segments.flatMap((segment) => {
    const tokens = segment.text.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return [];
    const start = Math.max(segment.start, 0);
    const duration = Math.max(segment.end - start, 0);
    const per = duration / tokens.length;
    return tokens.map((token, i) => ({
      word: token,
      start: round3(start + per * i),
      end: round3(start + per * (i + 1)),
      speaker: WHISPER_SPEAKER,
    }));
  });

  const fullText =
    body.text?.trim() || segments.map((s) => s.text.trim()).join(" ");

  return {
    fullText,
    language: whisperLanguageToIso(body.language),
    wordTimestamps: words,
  };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

const LANGUAGE_NAME_TO_ISO: Record<string, string> = {
  english: "en", spanish: "es", french: "fr", german: "de", italian: "it",
  portuguese: "pt", dutch: "nl", russian: "ru", japanese: "ja", chinese: "zh",
  korean: "ko", arabic: "ar", hindi: "hi", turkish: "tr", polish: "pl",
  ukrainian: "uk", swedish: "sv", norwegian: "no", danish: "da", finnish: "fi",
  czech: "cs", greek: "el", hebrew: "he", indonesian: "id", vietnamese: "vi",
  thai: "th", romanian: "ro", hungarian: "hu",
};

/**
 * verbose_json reports language as a lowercase English NAME ("english"),
 * not an ISO code. The transcripts.language column stores ISO codes
 * (Deepgram's detected_language convention), so map the common names and
 * pass already-ISO-looking values through.
 */
export function whisperLanguageToIso(name: string | undefined): string {
  if (!name) return "en";
  const lower = name.trim().toLowerCase();
  if (/^[a-z]{2}(-[a-z0-9]+)?$/.test(lower)) return lower;
  return LANGUAGE_NAME_TO_ISO[lower] ?? "en";
}
