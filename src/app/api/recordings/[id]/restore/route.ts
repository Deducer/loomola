import { NextResponse } from "next/server";
import { restoreRecording } from "@/db/queries/recordings";
import { requireAuth } from "@/lib/require-auth";

/// Clears deleted_at on a trashed recording — the restore half of the trash
/// bin the delete UI has always promised.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth(request);
  const { id } = await params;
  const restored = await restoreRecording(id, user.id);
  if (!restored) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
