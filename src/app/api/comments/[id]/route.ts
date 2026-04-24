import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/require-auth";
import { deleteCommentOwned } from "@/db/queries/comments";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth();
  const { id } = await params;
  const ok = await deleteCommentOwned({ commentId: id, ownerId: user.id });
  if (!ok) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
