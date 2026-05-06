import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/require-auth";
import {
  addRecordingToFolder,
  getFolderOwned,
  listFoldersForRecording,
} from "@/db/queries/folders";

/**
 * Multi-folder primitives for a single recording. Phase 1 of the
 * multi-folder migration (spec:
 * docs/superpowers/specs/2026-05-06-multi-folder-assignments-design.md).
 *
 * GET → list folders the recording is currently in.
 * POST { folderId } → add an assignment. Idempotent (re-add is a 200 no-op).
 *
 * Removal is at /api/recordings/{id}/folders/{folderId} (DELETE).
 *
 * The legacy `PATCH /api/recordings/{id}/folder { folderId }` endpoint
 * keeps working with single-folder semantics for the dashboard UI
 * until Phase 2 cuts those callers over.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth(request);
  const { id } = await params;
  const list = await listFoldersForRecording({
    recordingId: id,
    ownerId: user.id,
  });
  return NextResponse.json({
    folders: list.map((f) => ({ id: f.id, name: f.name, parentId: f.parentId })),
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth(request);
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    folderId?: string;
  };
  if (typeof body.folderId !== "string" || body.folderId.length === 0) {
    return NextResponse.json({ error: "bad_folder_id" }, { status: 400 });
  }
  const folder = await getFolderOwned(body.folderId, user.id);
  if (!folder) {
    return NextResponse.json({ error: "folder_not_found" }, { status: 404 });
  }
  const ok = await addRecordingToFolder({
    recordingId: id,
    ownerId: user.id,
    folderId: body.folderId,
  });
  if (!ok) {
    return NextResponse.json({ error: "recording_not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true }, { status: 201 });
}
