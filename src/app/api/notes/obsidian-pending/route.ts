import { NextResponse } from "next/server";
import { listObsidianPendingNotes } from "@/db/queries/notes";
import { enableGranola } from "@/lib/feature-flags";
import { requireAuth } from "@/lib/require-auth";
import { noteExportFilenameFromParts } from "@/lib/notes/export";
import { resolveObsidianPath } from "@/lib/notes/obsidian-path";

function granolaNotFound() {
  return NextResponse.json({ error: "not_found" }, { status: 404 });
}

export async function GET(request: Request) {
  if (!enableGranola()) return granolaNotFound();
  const user = await requireAuth(request);
  const pending = await listObsidianPendingNotes(user.id);

  return NextResponse.json({
    notes: pending.map((note) => {
      const title = note.title ?? note.aiTitle ?? "New note";
      return {
        mediaId: note.id,
        slug: note.slug,
        title,
        path: resolveObsidianPath({
          projectPath: note.meetingNotesVaultPath,
        }),
        filename: noteExportFilenameFromParts(
          { title, slug: note.slug, createdAt: note.createdAt },
          "md"
        ),
        exportUrl: `/api/notes/${note.id}/export.md`,
      };
    }),
  });
}
