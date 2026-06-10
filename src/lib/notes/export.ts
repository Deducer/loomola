import type { AudioNotePageData } from "@/db/queries/notes";
import type { Person } from "@/db/queries/people";
import type { SpeakerAssignment } from "@/db/queries/speaker-assignments";
import { groupWordsIntoParagraphs, type Word } from "@/lib/viewer/paragraphs";

export type NoteExportPayload = {
  generatedAt: string;
  appUrl: string;
  audioUrl: string | null;
  resolvedObsidianPath: string;
  media: {
    id: string;
    slug: string;
    title: string;
    status: string;
    createdAt: string;
    durationSeconds: number | null;
    meetingDetectedApp: string | null;
    sourceContextHint: string | null;
  };
  project: {
    id: string;
    name: string;
    meetingNotesVaultPath: string | null;
  } | null;
  note: {
    body: string;
    updatedAt: string | null;
  };
  enhanced: {
    titleSuggested: string | null;
    summary: string | null;
    actionItems: unknown;
    generationStatus: string | null;
    generatedAt: string | null;
  };
  transcript: {
    fullText: string;
    language: string | null;
    provider: string | null;
    paragraphs: Array<{
      speaker: string | null;
      startSec: number;
      endSec: number;
      text: string;
    }>;
  };
};

export function buildNoteExportPayload(params: {
  data: AudioNotePageData;
  people: Person[];
  speakerAssignments: SpeakerAssignment[];
  appUrl: string;
  audioUrl: string | null;
  resolvedObsidianPath: string;
  generatedAt?: Date;
}): NoteExportPayload {
  const media = params.data.media;
  const transcript = params.data.transcript;
  const createdAt = media.createdAt.toISOString();
  const generatedAt = params.generatedAt ?? new Date();
  const title = media.title ?? params.data.aiOutput?.titleSuggested ?? "New note";

  return {
    generatedAt: generatedAt.toISOString(),
    appUrl: params.appUrl,
    audioUrl: params.audioUrl,
    resolvedObsidianPath: params.resolvedObsidianPath,
    media: {
      id: media.id,
      slug: media.slug,
      title,
      status: media.status,
      createdAt,
      durationSeconds:
        media.durationSeconds === null ? null : Number(media.durationSeconds),
      meetingDetectedApp: media.meetingDetectedApp,
      sourceContextHint: media.sourceContextHint,
    },
    project: params.data.brandProfile
      ? {
          id: params.data.brandProfile.id,
          name: params.data.brandProfile.name,
          meetingNotesVaultPath: params.data.brandProfile.meetingNotesVaultPath,
        }
      : null,
    note: {
      body: params.data.note?.body ?? "",
      updatedAt: params.data.note?.updatedAt.toISOString() ?? null,
    },
    enhanced: {
      titleSuggested: params.data.aiOutput?.titleSuggested ?? null,
      summary: params.data.aiOutput?.summary ?? null,
      actionItems: params.data.aiOutput?.actionItems ?? null,
      generationStatus: params.data.aiOutput?.generationStatusValue ?? null,
      generatedAt: params.data.aiOutput?.generatedAt.toISOString() ?? null,
    },
    transcript: {
      fullText: transcript?.fullText ?? "",
      language: transcript?.language ?? null,
      provider: transcript?.provider ?? null,
      paragraphs: buildTranscriptParagraphs({
        words: normalizeWords(transcript?.wordTimestamps),
        fallbackText: transcript?.fullText ?? "",
        people: params.people,
        speakerAssignments: params.speakerAssignments,
      }),
    },
  };
}

export function buildNoteMarkdown(payload: NoteExportPayload): string {
  const lines: string[] = [
    "---",
    `meeting_id: ${yamlString(payload.media.id)}`,
    `slug: ${yamlString(payload.media.slug)}`,
    `title: ${yamlString(payload.media.title)}`,
    `created_at: ${yamlString(payload.media.createdAt)}`,
    `status: ${yamlString(payload.media.status)}`,
    `duration_seconds: ${payload.media.durationSeconds ?? "null"}`,
    `project: ${yamlNullable(payload.project?.name ?? null)}`,
    `audio_url: ${yamlNullable(payload.audioUrl)}`,
    `notes_app_url: ${yamlString(payload.appUrl)}`,
    `obsidian_path: ${yamlString(payload.resolvedObsidianPath)}`,
    "---",
    "",
    `# ${payload.media.title}`,
    "",
    `- Date: ${formatDate(payload.media.createdAt)}`,
    `- Duration: ${formatDuration(payload.media.durationSeconds)}`,
    `- Status: ${payload.media.status}`,
    `- App: ${payload.appUrl}`,
  ];

  if (payload.audioUrl) lines.push(`- Audio: ${payload.audioUrl}`);
  if (payload.project) lines.push(`- Project: ${payload.project.name}`);
  if (payload.media.meetingDetectedApp) {
    lines.push(`- Source: ${payload.media.meetingDetectedApp}`);
  }

  lines.push("", "## Notes", "");
  lines.push(payload.note.body.trim() || "_No typed notes._");

  lines.push("", "## Enhanced Notes", "");
  lines.push(payload.enhanced.summary?.trim() || "_No enhanced notes yet._");

  lines.push("", "## Action Items", "");
  lines.push(formatActionItems(payload.enhanced.actionItems));

  lines.push("", "## Transcript", "");
  lines.push(buildTranscriptMarkdown(payload) || "_No transcript yet._");

  return `${lines.join("\n")}\n`;
}

export function buildTranscriptMarkdown(payload: NoteExportPayload): string {
  if (payload.transcript.paragraphs.length === 0) {
    return payload.transcript.fullText.trim();
  }

  const lines: string[] = [];
  let previousSpeaker: string | null = null;
  for (const paragraph of payload.transcript.paragraphs) {
    if (paragraph.speaker && paragraph.speaker !== previousSpeaker) {
      if (lines.length > 0) lines.push("");
      lines.push(`### ${paragraph.speaker}`);
      previousSpeaker = paragraph.speaker;
    }
    lines.push(`[${formatTimestamp(paragraph.startSec)}] ${paragraph.text}`);
  }
  return lines.join("\n");
}

export function noteExportFilename(payload: NoteExportPayload, ext: "md" | "json") {
  const date = payload.media.createdAt.slice(0, 10);
  const title = payload.media.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
  return `${date}-${title || payload.media.slug}.${ext}`;
}

function buildTranscriptParagraphs(params: {
  words: Word[];
  fallbackText: string;
  people: Person[];
  speakerAssignments: SpeakerAssignment[];
}): NoteExportPayload["transcript"]["paragraphs"] {
  const peopleById = new Map(params.people.map((person) => [person.id, person]));
  const assignmentBySpeaker = new Map(
    params.speakerAssignments.map((assignment) => [
      assignment.speakerIdx,
      assignment,
    ])
  );
  const paragraphs = groupWordsIntoParagraphs(params.words);
  if (paragraphs.length === 0) {
    const text = params.fallbackText.trim();
    return text ? [{ speaker: null, startSec: 0, endSec: 0, text }] : [];
  }

  return paragraphs.map((paragraph) => ({
    speaker:
      typeof paragraph.speaker === "number"
        ? speakerLabel(paragraph.speaker, assignmentBySpeaker, peopleById)
        : null,
    startSec: paragraph.startSec,
    endSec: paragraph.endSec,
    text: paragraph.text,
  }));
}

function normalizeWords(value: unknown): Word[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const word = "word" in item ? item.word : null;
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
        ...(typeof speaker === "number" ? { speaker } : {}),
      },
    ];
  });
}

function speakerLabel(
  speakerIdx: number,
  assignments: Map<number, SpeakerAssignment>,
  people: Map<string, Person>
) {
  const assignment = assignments.get(speakerIdx);
  if (assignment?.displayLabelOverride) return assignment.displayLabelOverride;
  if (assignment?.personId) {
    return people.get(assignment.personId)?.displayName ?? `Speaker ${speakerIdx + 1}`;
  }
  return `Speaker ${speakerIdx + 1}`;
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function yamlNullable(value: string | null): string {
  return value ? yamlString(value) : "null";
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function formatDuration(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value <= 0) return "unknown";
  return formatTimestamp(value);
}

function formatTimestamp(value: number): string {
  const seconds = Math.max(0, Math.round(value));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
  }
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function formatActionItems(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) return "_No action items._";
  return (
    value
      .map((item) => {
        if (typeof item === "string") return `- [ ] ${item}`;
        if (!item || typeof item !== "object") return null;
        const text = "text" in item ? item.text : null;
        const timestamp = "timestamp_sec" in item ? item.timestamp_sec : null;
        if (typeof text !== "string" || !text.trim()) return null;
        return `- [ ] ${text}${
          typeof timestamp === "number" ? ` (${formatTimestamp(timestamp)})` : ""
        }`;
      })
      .filter(Boolean)
      .join("\n") || "_No action items._"
  );
}
