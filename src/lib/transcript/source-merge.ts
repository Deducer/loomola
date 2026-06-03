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
  const kept: SourceTranscriptSegment[] = [];
  for (const segment of ordered) {
    if (segment.source !== "microphone") {
      kept.push(segment);
      continue;
    }

    let current: SourceTranscriptSegment | null = segment;
    for (const system of systemSegments) {
      if (!current) break;
      current = suppressEchoFromMic(current, system);
    }
    if (current) kept.push(current);
  }
  return kept.sort(sortSegments);
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

  const metrics = similarityMetrics(micTokens, systemTokens);
  const threshold = shorterCount <= 4 ? 0.8 : 0.72;
  if (metrics.score >= threshold) return true;

  if (!hasTightOverlap(mic, system)) return false;
  if (
    shorterCount <= 6 &&
    metrics.containment >= 0.58 &&
    metrics.significantOverlap >= 2
  ) {
    return true;
  }
  if (metrics.containment >= 0.54 && metrics.significantOverlap >= 4) {
    return true;
  }
  if (
    metrics.longestRun >= 4 &&
    (metrics.longestSignificantRun >= 2 || metrics.longestRun >= 6)
  ) {
    return true;
  }
  return false;
}

function suppressEchoFromMic(
  mic: SourceTranscriptSegment,
  system: SourceTranscriptSegment
): SourceTranscriptSegment | null {
  if (!isNearby(mic, system)) return mic;
  const trimmed = trimBoundaryEcho(mic, system);
  if (trimmed !== mic) return trimmed;
  if (isEcho(mic, system)) return null;
  return mic;
}

function trimBoundaryEcho(
  mic: SourceTranscriptSegment,
  system: SourceTranscriptSegment
): SourceTranscriptSegment | null {
  if (!hasTightOverlap(mic, system)) return mic;
  if (mic.words.length === 0 || system.words.length === 0) return mic;

  const micTokens = mic.words.map((word) => normalizedWord(word.word));
  const systemTokens = system.words.map((word) => normalizedWord(word.word));
  const prefixLength = boundaryMatchLength(micTokens, systemTokens, "prefix");
  const suffixLength = boundaryMatchLength(micTokens, systemTokens, "suffix");
  const trimStart = shouldTrimBoundaryMatch(micTokens.slice(0, prefixLength))
    ? prefixLength
    : 0;
  const trimEnd = shouldTrimBoundaryMatch(
    micTokens.slice(micTokens.length - suffixLength)
  )
    ? suffixLength
    : 0;

  if (trimStart === 0 && trimEnd === 0) return mic;
  if (trimStart + trimEnd >= mic.words.length) return null;
  return segmentFromWords(
    mic.source,
    mic.words.slice(trimStart, mic.words.length - trimEnd)
  );
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

function hasTightOverlap(
  mic: SourceTranscriptSegment,
  system: SourceTranscriptSegment
): boolean {
  return mic.startSec <= system.endSec + 0.35 && system.startSec <= mic.endSec + 0.35;
}

function similarityMetrics(leftTokens: string[], rightTokens: string[]): {
  score: number;
  containment: number;
  significantOverlap: number;
  longestRun: number;
  longestSignificantRun: number;
} {
  const left = new Set(leftTokens);
  const right = new Set(rightTokens);
  const intersection = [...left].filter((token) => right.has(token)).length;
  const union = new Set([...left, ...right]).size;
  if (union === 0) {
    return {
      score: 0,
      containment: 0,
      significantOverlap: 0,
      longestRun: 0,
      longestSignificantRun: 0,
    };
  }
  const jaccard = intersection / union;
  const containment = intersection / Math.min(left.size, right.size);
  const run = longestCommonRun(leftTokens, rightTokens);
  return {
    score: Math.max(jaccard, containment * 0.95),
    containment,
    significantOverlap: [...left].filter(
      (token) => right.has(token) && isSignificantToken(token)
    ).length,
    longestRun: run.length,
    longestSignificantRun: run.significantLength,
  };
}

function longestCommonRun(
  leftTokens: string[],
  rightTokens: string[]
): { length: number; significantLength: number } {
  let bestLength = 0;
  let bestSignificantLength = 0;
  for (let leftIndex = 0; leftIndex < leftTokens.length; leftIndex += 1) {
    for (let rightIndex = 0; rightIndex < rightTokens.length; rightIndex += 1) {
      let length = 0;
      let significantLength = 0;
      while (
        leftTokens[leftIndex + length] &&
        leftTokens[leftIndex + length] === rightTokens[rightIndex + length]
      ) {
        if (isSignificantToken(leftTokens[leftIndex + length])) {
          significantLength += 1;
        }
        length += 1;
      }
      if (length > bestLength) {
        bestLength = length;
        bestSignificantLength = significantLength;
      }
    }
  }
  return { length: bestLength, significantLength: bestSignificantLength };
}

function boundaryMatchLength(
  micTokens: string[],
  systemTokens: string[],
  boundary: "prefix" | "suffix"
): number {
  let best = 0;
  if (boundary === "prefix") {
    for (let systemStart = 0; systemStart < systemTokens.length; systemStart += 1) {
      let length = 0;
      while (
        micTokens[length] &&
        micTokens[length] === systemTokens[systemStart + length]
      ) {
        length += 1;
      }
      best = Math.max(best, length);
    }
    return best;
  }

  for (let systemEnd = 0; systemEnd < systemTokens.length; systemEnd += 1) {
    let length = 0;
    while (
      micTokens[micTokens.length - 1 - length] &&
      micTokens[micTokens.length - 1 - length] === systemTokens[systemEnd - length]
    ) {
      length += 1;
    }
    best = Math.max(best, length);
  }
  return best;
}

function shouldTrimBoundaryMatch(tokens: string[]): boolean {
  if (tokens.length < 4) return false;
  const significantCount = tokens.filter(isSignificantToken).length;
  return tokens.length >= 6 || significantCount >= 2;
}

function normalizedTokens(text: string): string[] {
  return text
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function normalizedWord(text: string): string {
  return normalizedTokens(text).join("");
}

const INSIGNIFICANT_TOKENS = new Set([
  "a",
  "an",
  "and",
  "are",
  "be",
  "but",
  "can",
  "do",
  "for",
  "got",
  "had",
  "has",
  "have",
  "i",
  "in",
  "is",
  "it",
  "like",
  "me",
  "of",
  "on",
  "or",
  "so",
  "that",
  "the",
  "this",
  "to",
  "was",
  "we",
  "what",
  "when",
  "with",
  "yeah",
  "you",
]);

function isSignificantToken(token: string): boolean {
  return token.length >= 3 && !INSIGNIFICANT_TOKENS.has(token);
}

function endsSentence(word: string): boolean {
  return /[.!?]["')\]]?$/.test(word.trim());
}
