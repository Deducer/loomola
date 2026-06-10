import {
  groupWordsIntoParagraphs,
  type Paragraph,
  type Word,
} from "@/lib/viewer/paragraphs";

export type RecordingTranscriptPayload = {
  title: string;
  slug: string;
  createdAt: Date | string;
  durationSeconds: number | string | null;
  shareUrl: string;
  fullText: string;
  wordTimestamps: unknown;
};

export function buildRecordingTranscriptMarkdown(
  payload: RecordingTranscriptPayload
): string {
  const paragraphs = transcriptParagraphs(payload);
  const lines = [
    `# ${payload.title}`,
    "",
    `- Recording: ${payload.shareUrl}`,
    `- Created: ${formatDate(payload.createdAt)}`,
    `- Duration: ${formatReadableDuration(payload.durationSeconds)}`,
    "",
    "## Transcript",
    "",
  ];

  if (paragraphs.length === 0) {
    lines.push("_No transcript yet._");
  } else {
    lines.push(
      ...paragraphs.map(
        (paragraph) => `[${formatDisplayTimestamp(paragraph.startSec)}] ${paragraph.text}`
      )
    );
  }

  return `${lines.join("\n")}\n`;
}

export function buildRecordingTranscriptSrt(
  payload: RecordingTranscriptPayload
): string {
  const paragraphs = transcriptParagraphs(payload, {
    maxGapSec: 0.8,
    maxParagraphSec: 6,
  });
  if (paragraphs.length === 0) return "";

  return `${paragraphs
    .map((paragraph, index) => {
      const startSec = Math.max(0, paragraph.startSec);
      const endSec = Math.max(startSec + 0.5, paragraph.endSec);
      return [
        String(index + 1),
        `${formatSrtTimestamp(startSec)} --> ${formatSrtTimestamp(endSec)}`,
        paragraph.text,
      ].join("\n");
    })
    .join("\n\n")}\n`;
}

export function recordingTranscriptFilename(
  payload: Pick<RecordingTranscriptPayload, "title" | "slug" | "createdAt">,
  ext: "md" | "srt"
): string {
  const date = createdDatePrefix(payload.createdAt);
  const titleSlug = payload.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
  return `${date}-${titleSlug || payload.slug}-transcript.${ext}`;
}

export function transcriptDownloadHeaders(filename: string, contentType: string) {
  return {
    "content-type": contentType,
    "content-disposition": `attachment; filename="${filename.replace(/"/g, "")}"`,
    "cache-control": "private, no-store",
  };
}

function transcriptParagraphs(
  payload: RecordingTranscriptPayload,
  opts?: Parameters<typeof groupWordsIntoParagraphs>[1]
): Paragraph[] {
  const words = normalizeWords(payload.wordTimestamps);
  const paragraphs = groupWordsIntoParagraphs(words, opts);
  if (paragraphs.length > 0) return paragraphs;

  const fallbackText = payload.fullText.trim();
  if (!fallbackText) return [];
  return [
    {
      startSec: 0,
      endSec: fallbackDuration(payload.durationSeconds),
      text: fallbackText,
    },
  ];
}

function normalizeWords(value: unknown): Word[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const word = "word" in item ? item.word : null;
    const punctuatedWord = "punctuated_word" in item ? item.punctuated_word : null;
    const start = "start" in item ? item.start : null;
    const end = "end" in item ? item.end : null;
    const speaker = "speaker" in item ? item.speaker : null;
    if (typeof word !== "string") return [];
    if (typeof start !== "number" || typeof end !== "number") return [];
    return [
      {
        word,
        start,
        end,
        ...(typeof punctuatedWord === "string"
          ? { punctuated_word: punctuatedWord }
          : {}),
        ...(typeof speaker === "number" ? { speaker } : {}),
      },
    ];
  });
}

function formatDate(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toISOString();
}

function formatReadableDuration(value: number | string | null): string {
  const seconds = numericSeconds(value);
  if (seconds === null || seconds <= 0) return "unknown";
  return formatDisplayTimestamp(seconds);
}

function formatDisplayTimestamp(value: number): string {
  const seconds = Math.max(0, Math.round(value));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
  }
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function formatSrtTimestamp(value: number): string {
  const totalMs = Math.max(0, Math.round(value * 1000));
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const seconds = Math.floor((totalMs % 60_000) / 1000);
  const ms = totalMs % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

function fallbackDuration(value: number | string | null): number {
  const seconds = numericSeconds(value);
  if (seconds === null || seconds <= 0) return 2;
  return Math.min(seconds, 10);
}

function numericSeconds(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function createdDatePrefix(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "recording";
  return date.toISOString().slice(0, 10);
}
