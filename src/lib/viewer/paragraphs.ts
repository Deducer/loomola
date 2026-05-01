export type Word = {
  word: string;
  start: number;
  end: number;
  punctuated_word?: string;
  speaker?: number;
};

export type Paragraph = {
  startSec: number;
  endSec: number;
  text: string;
  speaker?: number;
};

type GroupOpts = {
  maxGapSec?: number;
  maxParagraphSec?: number;
};

const DEFAULTS: Required<GroupOpts> = {
  maxGapSec: 1.5,
  maxParagraphSec: 30,
};

/**
 * Groups Deepgram-style word timestamps into paragraphs. Starts a new
 * paragraph whenever the gap before the current word exceeds `maxGapSec`,
 * or when the running paragraph has already covered `maxParagraphSec`.
 */
export function groupWordsIntoParagraphs(
  words: Word[],
  opts: GroupOpts = {}
): Paragraph[] {
  if (words.length === 0) return [];
  const { maxGapSec, maxParagraphSec } = { ...DEFAULTS, ...opts };

  const paragraphs: Paragraph[] = [];
  let buffer: Word[] = [];
  let bufStart = words[0].start;

  const flush = () => {
    if (buffer.length === 0) return;
    paragraphs.push({
      startSec: bufStart,
      endSec: buffer[buffer.length - 1].end,
      text: buffer.map((b) => b.punctuated_word ?? b.word).join(" "),
      speaker: buffer[0].speaker,
    });
    buffer = [];
  };

  for (let i = 0; i < words.length; i++) {
    const cur = words[i];
    if (buffer.length === 0) {
      bufStart = cur.start;
      buffer.push(cur);
      continue;
    }
    const prev = buffer[buffer.length - 1];
    const gap = cur.start - prev.end;
    const runLen = cur.end - bufStart;
    if (
      gap > maxGapSec ||
      runLen > maxParagraphSec ||
      cur.speaker !== prev.speaker
    ) {
      flush();
      bufStart = cur.start;
    }
    buffer.push(cur);
  }
  flush();
  return paragraphs;
}

/**
 * Binary search for the paragraph whose [startSec, endSec) window contains
 * `currentSec`. Returns the clamped last index if `currentSec` is past the
 * end, 0 if before the start, and -1 if the array is empty.
 */
export function findActiveParagraphIndex(
  paragraphs: Paragraph[],
  currentSec: number
): number {
  if (paragraphs.length === 0) return -1;
  if (currentSec < paragraphs[0].startSec) return 0;
  if (currentSec >= paragraphs[paragraphs.length - 1].endSec) {
    return paragraphs.length - 1;
  }
  let lo = 0;
  let hi = paragraphs.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const p = paragraphs[mid];
    if (currentSec < p.startSec) hi = mid - 1;
    else if (currentSec >= p.endSec) lo = mid + 1;
    else return mid;
  }
  return Math.max(0, hi);
}
