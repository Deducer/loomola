import { getAudioNotePageData } from "@/db/queries/notes";
import { getMcpOwnerId } from "@/app/api/mcp/tools/owner";
import { listPeople } from "@/db/queries/people";
import { listSpeakerAssignments } from "@/db/queries/speaker-assignments";
import { hasIntegrationToken } from "@/lib/integration-auth";
import { requireAuth } from "@/lib/require-auth";
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

export async function resolveNoteExportOwnerId(params: {
  request: Request;
  identifier: string;
}): Promise<string | null> {
  if (!hasIntegrationToken(params.request)) {
    const user = await requireAuth(params.request);
    return user.id;
  }
  // The integration token is instance-wide, not per-user. Resolving the owner
  // from the note itself let the token export ANY user's note once invite-based
  // multi-user shipped. Pin it to the same single account the MCP server uses
  // (MCP_OWNER_ID / MCP_OWNER_EMAIL, or the sole user); throws on an unpinned
  // multi-user instance, which we surface as not-found.
  try {
    return await getMcpOwnerId();
  } catch {
    return null;
  }
}
