import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/require-auth";
import { getFolderOwned, moveRecordingToFolder } from "@/db/queries/folders";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth();
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    folderId?: string | null;
  };
  if (
    body.folderId !== null &&
    typeof body.folderId !== "string" &&
    body.folderId !== undefined
  ) {
    return NextResponse.json({ error: "bad_folder_id" }, { status: 400 });
  }
  const target = body.folderId ?? null;
  if (target !== null) {
    const f = await getFolderOwned(target, user.id);
    if (!f) {
      return NextResponse.json({ error: "folder_not_found" }, { status: 404 });
    }
  }
  const ok = await moveRecordingToFolder({
    recordingId: id,
    ownerId: user.id,
    folderId: target,
  });
  if (!ok) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
