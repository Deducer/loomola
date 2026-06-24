import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import {
  createNoteAttachment,
  getAudioNoteAccess,
  listNoteAttachments,
} from "@/db/queries/notes";
import { enableGranola } from "@/lib/feature-flags";
import { requireAuth } from "@/lib/require-auth";
import { presignGet } from "@/lib/r2/presigned-get";
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
    attachments: await Promise.all(
      attachments.map(async (attachment) => ({
        id: attachment.id,
        filename: attachment.filename,
        contentType: attachment.contentType,
        byteSize: attachment.byteSize,
        createdAt: attachment.createdAt.toISOString(),
        url: await presignGet(attachment.r2Key),
      }))
    ),
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

  const bytes = new Uint8Array(await file.arrayBuffer());
  const key = `note-attachments/${user.id}/${data.id}/${nanoid(12)}.${ext}`;
  await uploadBytes(key, bytes, file.type);

  const attachment = await createNoteAttachment({
    mediaObjectId: data.id,
    ownerId: user.id,
    r2Key: key,
    filename: file.name || `attachment.${ext}`,
    contentType: file.type,
    byteSize: file.size,
  });

  return NextResponse.json(
    {
      attachment: {
        id: attachment.id,
        filename: attachment.filename,
        contentType: attachment.contentType,
        byteSize: attachment.byteSize,
        createdAt: attachment.createdAt.toISOString(),
        url: await presignGet(attachment.r2Key),
      },
    },
    { status: 201 }
  );
}
