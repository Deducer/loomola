import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/require-auth";
import { removeRecordingFromFolder } from "@/db/queries/folders";

/**
 * Remove a single folder assignment from a recording. Idempotent —
 * removing a nonexistent assignment is a 200 no-op rather than a 404.
 *
 * Phase 1 of the multi-folder migration (spec:
 * docs/superpowers/specs/2026-05-06-multi-folder-assignments-design.md).
 * Reads still go through the legacy `media_objects.folder_id` column;
 * this endpoint only mutates the join table. If the user removes the
 * folder that *is* the legacy column, the legacy column stays pointing
 * at the now-detached folder until they reassign via the legacy
 * `PATCH /folder` route. That mismatch is acceptable during dual-write
 * because no read paths consult the join table yet.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; folderId: string }> }
) {
  const user = await requireAuth(request);
  const { id, folderId } = await params;
  await removeRecordingFromFolder({
    recordingId: id,
    ownerId: user.id,
    folderId,
  });
  return NextResponse.json({ ok: true });
}
