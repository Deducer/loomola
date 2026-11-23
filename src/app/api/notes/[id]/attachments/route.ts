import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import {
  countNoteScreenshots,
  createNoteAttachment,
  getAudioNoteAccess,
  listNoteAttachments,
} from "@/db/queries/notes";
import { enableGranola } from "@/lib/feature-flags";
import { noteAttachmentJson } from "@/lib/notes/attachment-json";
import { describeScreenshot } from "@/lib/notes/describe-screenshot";
import {
  MAX_SCREENSHOTS_PER_NOTE,
  parseScreenshotUpload,
} from "@/lib/notes/screenshots";
import { requireAuth } from "@/lib/require-auth";
import { uploadBytes } from "@/lib/r2/upload-bytes";

const MAX_ATTACHMENT_BYTES = 12 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
]);

function granolaNotFound() {
  return NextResponse.json({ error: "not_found" }, { status: 404 });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!enableGranola()) return granolaNotFound();
  const user = await requireAuth(request);
  const { id } = await params;
  const data = await getAudioNoteAccess(id, user.id);
  if (!data) return granolaNotFound();

  const attachments = await listNoteAttachments(data.id, user.id);
  return NextResponse.json({
    attachments: await Promise.all(attachments.map(noteAttachmentJson)),
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!enableGranola()) return granolaNotFound();
  const user = await requireAuth(request);
  const { id } = await params;
  const data = await getAudioNoteAccess(id, user.id);
  if (!data) return granolaNotFound();

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file_required" }, { status: 400 });
  }

  const ext = ALLOWED_IMAGE_TYPES.get(file.type);
  if (!ext) {
    return NextResponse.json({ error: "unsupported_image" }, { status: 400 });
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return NextResponse.json({ error: "image_too_large" }, { status: 413 });
  }

  const upload = parseScreenshotUpload(
    formData.get("kind"),
    formData.get("offsetMs")
  );
  if (!upload.ok) {
    return NextResponse.json({ error: upload.error }, { status: 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  // A screenshot from the desktop app is described before it is stored, so a
  // frame of participant tiles with nothing shared never reaches storage.
  let description: string | null = null;
  if (upload.kind === "screenshot") {
    if ((await countNoteScreenshots(data.id)) >= MAX_SCREENSHOTS_PER_NOTE) {
      return NextResponse.json({ error: "screenshot_limit" }, { status: 409 });
    }
    const verdict = await describeScreenshot(bytes, file.type);
    if (verdict.kind === "no_shared_content") {
      return NextResponse.json({ attachment: null, skipped: "no_shared_content" });
    }
    if (verdict.kind === "described") description = verdict.description;
  }

  const key = `note-attachments/${user.id}/${data.id}/${nanoid(12)}.${ext}`;
  await uploadBytes(key, bytes, file.type);

  const attachment = await createNoteAttachment({
    mediaObjectId: data.id,
    ownerId: user.id,
    r2Key: key,
    filename: file.name || `attachment.${ext}`,
    contentType: file.type,
    byteSize: file.size,
    kind: upload.kind,
    offsetMs: upload.kind === "screenshot" ? upload.offsetMs : null,
    description,
  });

  return NextResponse.json(
    { attachment: await noteAttachmentJson(attachment) },
    { status: 201 }
  );
}
