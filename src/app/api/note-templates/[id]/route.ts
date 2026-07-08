import { NextResponse } from "next/server";
import { enableGranola } from "@/lib/feature-flags";
import { requireAuth } from "@/lib/require-auth";
import { deleteUserNoteTemplate } from "@/db/queries/note-templates";

function granolaNotFound() {
  return NextResponse.json({ error: "not_found" }, { status: 404 });
}

/// Delete one of the caller's own templates. Built-ins can't be
/// deleted (there's no row to delete); notes referencing a deleted
/// template fall back to the default at resolution time.
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!enableGranola()) return granolaNotFound();
  const user = await requireAuth(request);
  const { id } = await params;
  const ok = await deleteUserNoteTemplate(user.id, id);
  if (!ok) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
