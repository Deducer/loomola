import { NextResponse } from "next/server";
import { getAudioNotePageData } from "@/db/queries/notes";
import { enableGranola } from "@/lib/feature-flags";
import { requireAuth } from "@/lib/require-auth";
import { resolveObsidianPath } from "@/lib/notes/obsidian-path";

function granolaNotFound() {
  return NextResponse.json({ error: "not_found" }, { status: 404 });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!enableGranola()) return granolaNotFound();
  const user = await requireAuth(request);
  const { id } = await params;
  const data = await getAudioNotePageData(id, user.id);
  if (!data) return granolaNotFound();

  const requestedAt = data.media.obsidianSaveRequestedAt?.toISOString() ?? null;
  const syncedAt = data.media.obsidianSyncedAt?.toISOString() ?? null;
  const status = requestedAt && !syncedAt ? "queued" : syncedAt ? "synced" : "idle";

  return NextResponse.json({
    status,
    requestedAt,
    syncedAt,
    path: resolveObsidianPath({
      projectPath: data.brandProfile?.meetingNotesVaultPath,
    }),
  });
}
