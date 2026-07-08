import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/require-auth";
import { enableGranola } from "@/lib/feature-flags";
import { presignGet } from "@/lib/r2/presigned-get";
import {
  getAudioNotePageData,
  listNoteAttachments,
} from "@/db/queries/notes";
import { listPeople } from "@/db/queries/people";
import {
  listNoteTemplatesForOwner,
  resolveNoteTemplate,
} from "@/db/queries/note-templates";
import { listSpeakerAssignments } from "@/db/queries/speaker-assignments";
import { listFoldersForOwner } from "@/db/queries/folders";
import {
  NotePageClient,
  type NoteActionItem,
} from "@/components/notes/note-page-client";
import { resolveObsidianPath } from "@/lib/notes/obsidian-path";
import type { Word } from "@/lib/viewer/paragraphs";
import {
  DEFAULT_NOTE_TEMPLATE_ID,
} from "@/lib/ai/note-templates";

export default async function NotesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!enableGranola()) notFound();

  const user = await requireAuth();
  const { id } = await params;
  const data = await getAudioNotePageData(id, user.id);
  if (!data) notFound();

  const [
    audioUrl,
    waveformUrl,
    people,
    speakerAssignments,
    attachments,
    folders,
  ] = await Promise.all([
    data.media.r2MixedKey ? presignGet(data.media.r2MixedKey) : Promise.resolve(null),
    data.media.compositeThumbnailKey
      ? presignGet(data.media.compositeThumbnailKey)
      : Promise.resolve(null),
    listPeople(user.id),
    listSpeakerAssignments(data.media.id, user.id),
    listNoteAttachments(data.media.id, user.id),
    listFoldersForOwner(user.id),
  ]);
  const initialObsidianStatus =
    data.media.obsidianSaveRequestedAt && !data.media.obsidianSyncedAt
      ? "queued"
      : data.media.obsidianSyncedAt
        ? "synced"
        : "idle";

  return (
    <NotePageClient
      mediaId={data.media.id}
      initialTitle={data.media.title ?? data.aiOutput?.titleSuggested ?? null}
      createdAt={data.media.createdAt.toISOString()}
      status={data.media.status}
      durationSeconds={data.media.durationSeconds}
      attendees={data.media.attendees}
      initialFolderId={data.media.folderId}
      folders={folders.map((folder) => ({
        id: folder.id,
        name: folder.name,
        parentId: folder.parentId,
      }))}
      initialBody={data.note?.body ?? ""}
      initialTemplateId={
        (
          await resolveNoteTemplate(
            user.id,
            data.note?.templateId ??
              data.aiOutput?.templateId ??
              DEFAULT_NOTE_TEMPLATE_ID
          )
        ).id
      }
      initialGeneratedTemplateId={data.aiOutput?.templateId ?? null}
      templates={await listNoteTemplatesForOwner(user.id)}
      audioUrl={audioUrl}
      waveformUrl={waveformUrl}
      transcriptText={data.transcript?.fullText ?? ""}
      transcriptWords={normalizeWords(data.transcript?.wordTimestamps)}
      initialAttachments={await Promise.all(
        attachments.map(async (attachment) => ({
          id: attachment.id,
          filename: attachment.filename,
          contentType: attachment.contentType,
          byteSize: attachment.byteSize,
          createdAt: attachment.createdAt.toISOString(),
          url: await presignGet(attachment.r2Key),
        }))
      )}
      initialEnhancedSummary={data.aiOutput?.summary ?? null}
      initialActionItems={normalizeActionItems(data.aiOutput?.actionItems)}
      initialGenerationStatus={data.aiOutput?.generationStatusValue ?? "idle"}
      initialObsidianSaveState={initialObsidianStatus}
      initialObsidianPath={resolveObsidianPath({
        projectPath: data.brandProfile?.meetingNotesVaultPath,
      })}
      people={people.map((person) => ({
        id: person.id,
        displayName: person.displayName,
        email: person.email,
        isSelf: person.isSelf,
      }))}
      speakerAssignments={speakerAssignments.map((assignment) => ({
        speakerIdx: assignment.speakerIdx,
        personId: assignment.personId,
        displayLabelOverride: assignment.displayLabelOverride,
        isSuggestion: assignment.isSuggestion,
        suggestedNewPersonPayload:
          assignment.suggestedNewPersonPayload as
            | { displayName: string | null; email: string | null }
            | null
            | undefined,
      }))}
    />
  );
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

function normalizeActionItems(value: unknown): NoteActionItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const text = "text" in item ? item.text : null;
    const timestamp = "timestamp_sec" in item ? item.timestamp_sec : null;
    if (typeof text !== "string" || !text.trim()) return [];
    if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) return [];
    return [{ text: text.trim(), timestamp_sec: Math.max(0, timestamp) }];
  });
}
