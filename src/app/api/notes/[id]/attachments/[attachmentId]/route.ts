import { NextResponse } from "next/server";
import {
  deleteNoteAttachment,
  getAudioNoteAccess,
} from "@/db/queries/notes";
import { enableGranola } from "@/lib/feature-flags";
import { requireAuth } from "@/lib/require-auth";

function granolaNotFound() {
  return NextResponse.json({ error: "not_found" }, { status: 404 });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; attachmentId: string }> }
) {
  if (!enableGranola()) return granolaNotFound();
  const user = await requireAuth(request);
  const { id, attachmentId } = await params;
  const data = await getAudioNoteAccess(id, user.id);
  if (!data) return granolaNotFound();

  const removed = await deleteNoteAttachment({
    id: attachmentId,
    mediaObjectId: data.id,
    ownerId: user.id,
  });

  return NextResponse.json({ removed });
}
