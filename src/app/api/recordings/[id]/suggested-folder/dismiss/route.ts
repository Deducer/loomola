import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/require-auth";
import { dismissSuggestion } from "@/db/queries/folder-suggestion";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth(request);
  const { id } = await params;

  const ok = await dismissSuggestion({
    mediaObjectId: id,
    ownerId: user.id,
  });

  if (!ok) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
