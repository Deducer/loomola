import { getAudioNotePageData } from "@/db/queries/notes";
import { listPeople } from "@/db/queries/people";
import { listSpeakerAssignments } from "@/db/queries/speaker-assignments";
import { presignGet } from "@/lib/r2/presigned-get";
import {
  buildNoteExportPayload,
  noteExportFilename,
  type NoteExportPayload,
} from "@/lib/notes/export";
import { resolveObsidianPath } from "@/lib/notes/obsidian-path";

export async function loadNoteExportPayload(params: {
  identifier: string;
  ownerId: string;
  requestUrl: string;
  overrideObsidianPath?: string | null;
}): Promise<NoteExportPayload | null> {
  const data = await getAudioNotePageData(params.identifier, params.ownerId);
  if (!data) return null;

  const audioKey =
    data.media.r2MixedKey ?? data.media.r2MicKey ?? data.media.r2SystemaudioKey;
  const [audioUrl, people, speakerAssignments] = await Promise.all([
    audioKey ? presignGet(audioKey) : Promise.resolve(null),
    listPeople(params.ownerId),
    listSpeakerAssignments(data.media.id, params.ownerId),
  ]);
  const appBaseUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? new URL(params.requestUrl).origin;

  return buildNoteExportPayload({
    data,
    people,
    speakerAssignments,
    appUrl: `${appBaseUrl}/notes/${data.media.slug}`,
    audioUrl,
    resolvedObsidianPath: resolveObsidianPath({
      overridePath: params.overrideObsidianPath,
      projectPath: data.brandProfile?.meetingNotesVaultPath,
    }),
  });
}

export function downloadHeaders(
  payload: NoteExportPayload,
  contentType: string,
  filename?: string
) {
  return {
    "content-type": contentType,
    "content-disposition": `attachment; filename="${
      filename ??
      noteExportFilename(payload, contentType.includes("json") ? "json" : "md")
    }"`,
    "cache-control": "private, no-store",
  };
}
