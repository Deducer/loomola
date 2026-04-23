export type Word = {
  word: string;
  start: number;
  end: number;
  punctuated_word?: string;
};

export type Paragraph = {
  startSec: number;
  endSec: number;
  text: string;
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
    if (gap > maxGapSec || runLen > maxParagraphSec) {
      flush();
      bufStart = cur.start;
    }
    buffer.push(cur);
  }
  flush();
  return paragraphs;
}
