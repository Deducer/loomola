export type TranscriptSource = "microphone" | "systemAudio" | "unknown";

export type SourceTranscriptWord = {
  word: string;
  start: number;
  end: number;
  confidence?: number;
  speaker?: number;
};

export type SourceTranscriptSegment = {
  source: TranscriptSource;
  startSec: number;
  endSec: number;
  text: string;
  words: SourceTranscriptWord[];
};

export function sourceForDeepgramChannel(index: number): TranscriptSource {
  if (index === 0) return "microphone";
  if (index === 1) return "systemAudio";
  return "unknown";
}

export function speakerForTranscriptSource(source: TranscriptSource): number | undefined {
  if (source === "microphone") return 0;
  if (source === "systemAudio") return 1;
  return undefined;
}

export function buildSegmentsFromWords(params: {
  source: TranscriptSource;
  transcript?: string;
  words: SourceTranscriptWord[];
}): SourceTranscriptSegment[] {
  const words = params.words
    .filter((word) => word.word.trim().length > 0)
    .sort((a, b) => a.start - b.start);

  if (words.length === 0) {
    const text = params.transcript?.trim();
    return text
      ? [{ source: params.source, startSec: 0, endSec: 0, text, words: [] }]
      : [];
  }

  const segments: SourceTranscriptSegment[] = [];
  let buffer: SourceTranscriptWord[] = [];
  let previousEnd = words[0]?.start ?? 0;

  for (const word of words) {
    const gap = word.start - previousEnd;
    if (buffer.length > 0 && gap > 0.9) {
      segments.push(segmentFromWords(params.source, buffer));
      buffer = [];
    }

    buffer.push(word);
    previousEnd = word.end;

    if (endsSentence(word.word)) {
      segments.push(segmentFromWords(params.source, buffer));
      buffer = [];
    }
  }

  if (buffer.length > 0) {
    segments.push(segmentFromWords(params.source, buffer));
  }

  return segments;
}

export function mergeSourceTranscriptSegments(segments: SourceTranscriptSegment[]): {
  fullText: string;
  words: SourceTranscriptWord[];
} {
  const kept = suppressEchoSegments(segments);
  return {
    fullText: kept.map((segment) => segment.text).join("\n\n"),
    words: kept.flatMap((segment) => {
      const speaker = speakerForTranscriptSource(segment.source);
      return segment.words.map((word) => ({
        ...word,
        ...(typeof speaker === "number" ? { speaker } : {}),
      }));
    }),
  };
}

export function suppressEchoSegments(
  segments: SourceTranscriptSegment[]
): SourceTranscriptSegment[] {
  const ordered = [...segments].sort(sortSegments);
  const systemSegments = ordered.filter((segment) => segment.source === "systemAudio");
  return ordered.filter((segment) => {
    if (segment.source !== "microphone") return true;
    return !systemSegments.some((system) => isEcho(segment, system));
  });
}

function segmentFromWords(
  source: TranscriptSource,
  words: SourceTranscriptWord[]
): SourceTranscriptSegment {
  return {
    source,
    startSec: words[0]?.start ?? 0,
    endSec: words.at(-1)?.end ?? 0,
    text: words.map((word) => word.word).join(" "),
    words,
  };
}

function sortSegments(
  left: SourceTranscriptSegment,
  right: SourceTranscriptSegment
): number {
  if (left.startSec !== right.startSec) return left.startSec - right.startSec;
  return sourceSort(left.source) - sourceSort(right.source);
}

function sourceSort(source: TranscriptSource): number {
  if (source === "microphone") return 0;
  if (source === "systemAudio") return 1;
  return 2;
}

function isEcho(
  mic: SourceTranscriptSegment,
  system: SourceTranscriptSegment
): boolean {
  if (!isNearby(mic, system)) return false;
  const micTokens = normalizedTokens(mic.text);
  const systemTokens = normalizedTokens(system.text);
  if (micTokens.length === 0 || systemTokens.length === 0) return false;

  const shorterCount = Math.min(micTokens.length, systemTokens.length);
  if (shorterCount <= 2) {
    return micTokens.join(" ") === systemTokens.join(" ");
  }

  const score = similarity(micTokens, systemTokens);
  const threshold = shorterCount <= 4 ? 0.8 : 0.72;
  return score >= threshold;
}

function isNearby(
  mic: SourceTranscriptSegment,
  system: SourceTranscriptSegment
): boolean {
  const paddedOverlap =
    mic.startSec <= system.endSec + 2.5 && system.startSec <= mic.endSec + 2.5;
  const startsClose = Math.abs(mic.startSec - system.startSec) <= 4.0;
  return paddedOverlap || startsClose;
}

function similarity(leftTokens: string[], rightTokens: string[]): number {
  const left = new Set(leftTokens);
  const right = new Set(rightTokens);
  const intersection = [...left].filter((token) => right.has(token)).length;
  const union = new Set([...left, ...right]).size;
  if (union === 0) return 0;
  const jaccard = intersection / union;
  const containment = intersection / Math.min(left.size, right.size);
  return Math.max(jaccard, containment * 0.95);
}

function normalizedTokens(text: string): string[] {
  return text
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function endsSentence(word: string): boolean {
  return /[.!?]["')\]]?$/.test(word.trim());
}
