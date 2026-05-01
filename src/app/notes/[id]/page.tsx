import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/require-auth";
import { enableGranola } from "@/lib/feature-flags";
import { presignGet } from "@/lib/r2/presigned-get";
import { getAudioNotePageData } from "@/db/queries/notes";
import { listPeople } from "@/db/queries/people";
import { listSpeakerAssignments } from "@/db/queries/speaker-assignments";
import { NotePageClient } from "@/components/notes/note-page-client";
import type { Word } from "@/lib/viewer/paragraphs";

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

  const [audioUrl, waveformUrl, people, speakerAssignments] = await Promise.all([
    data.media.r2MixedKey ? presignGet(data.media.r2MixedKey) : Promise.resolve(null),
    data.media.compositeThumbnailKey
      ? presignGet(data.media.compositeThumbnailKey)
      : Promise.resolve(null),
    listPeople(user.id),
    listSpeakerAssignments(data.media.id, user.id),
  ]);

  return (
    <NotePageClient
      mediaId={data.media.id}
      initialTitle={data.media.title}
      createdAt={data.media.createdAt.toISOString()}
      status={data.media.status}
      durationSeconds={data.media.durationSeconds}
      attendees={data.media.attendees}
      folderLabel={null}
      initialBody={data.note?.body ?? ""}
      audioUrl={audioUrl}
      waveformUrl={waveformUrl}
      transcriptText={data.transcript?.fullText ?? ""}
      transcriptWords={normalizeWords(data.transcript?.wordTimestamps)}
      people={people.map((person) => ({
        id: person.id,
        displayName: person.displayName,
      }))}
      speakerAssignments={speakerAssignments.map((assignment) => ({
        speakerIdx: assignment.speakerIdx,
        personId: assignment.personId,
        displayLabelOverride: assignment.displayLabelOverride,
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
