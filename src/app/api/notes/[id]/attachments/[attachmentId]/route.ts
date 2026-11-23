import { NextResponse } from "next/server";
import {
  deleteNoteAttachment,
  getAudioNoteAccess,
} from "@/db/queries/notes";
import { enableGranola } from "@/lib/feature-flags";
import { deleteObjects } from "@/lib/r2/delete-objects";
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
  // Removing a picture removes the picture. Without this the stored file
  // outlives its row and nothing ever finds it again.
  if (removed) {
    await deleteObjects([removed.r2Key]).catch((err) =>
      console.warn("[attachments] could not delete stored file:", err)
    );
  }

  return NextResponse.json({ removed: removed !== null });
}
