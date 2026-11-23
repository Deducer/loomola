import type { NoteAttachment } from "@/db/queries/notes";
import { presignGet } from "@/lib/r2/presigned-get";

/** The attachment shape the note API, the web note page and the desktop app share. */
export async function noteAttachmentJson(attachment: NoteAttachment) {
  return {
    id: attachment.id,
    kind: attachment.kind,
    filename: attachment.filename,
    contentType: attachment.contentType,
    byteSize: attachment.byteSize,
    createdAt: attachment.createdAt.toISOString(),
    offsetMs: attachment.offsetMs,
    description: attachment.description,
    url: await presignGet(attachment.r2Key),
  };
}
