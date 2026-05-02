import { NextResponse } from "next/server";
import { z } from "zod";
import { getAudioNotePageData, markObsidianSynced } from "@/db/queries/notes";
import { enableGranola } from "@/lib/feature-flags";
import { requireAuth } from "@/lib/require-auth";

const syncedSchema = z.object({
  filePath: z.string().min(1).max(1000),
});

function granolaNotFound() {
  return NextResponse.json({ error: "not_found" }, { status: 404 });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!enableGranola()) return granolaNotFound();
  const user = await requireAuth(request);
  const { id } = await params;
  const data = await getAudioNotePageData(id, user.id);
  if (!data) return granolaNotFound();

  const json = await request.json().catch(() => ({}));
  const parsed = syncedSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "file_path_required" }, { status: 400 });
  }

  const synced = await markObsidianSynced(data.media.id, user.id);
  if (!synced) return granolaNotFound();

  return NextResponse.json({ ok: true, filePath: parsed.data.filePath });
}
