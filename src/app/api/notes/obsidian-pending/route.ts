import { NextResponse } from "next/server";
import { listObsidianPendingNotes } from "@/db/queries/notes";
import { enableGranola } from "@/lib/feature-flags";
import { requireAuth } from "@/lib/require-auth";
import { noteExportFilename } from "@/lib/notes/export";
import { loadNoteExportPayload } from "@/lib/notes/export-route";

function granolaNotFound() {
  return NextResponse.json({ error: "not_found" }, { status: 404 });
}

export async function GET(request: Request) {
  if (!enableGranola()) return granolaNotFound();
  const user = await requireAuth(request);
  const pending = await listObsidianPendingNotes(user.id);
  const payloads = await Promise.all(
    pending.map((note) =>
      loadNoteExportPayload({
        identifier: note.id,
        ownerId: user.id,
        requestUrl: request.url,
      })
    )
  );

  return NextResponse.json({
    notes: payloads.flatMap((payload) =>
      payload
        ? [
            {
              mediaId: payload.media.id,
              slug: payload.media.slug,
              title: payload.media.title,
              path: payload.resolvedObsidianPath,
              filename: noteExportFilename(payload, "md"),
              exportUrl: `/api/notes/${payload.media.id}/export.md`,
            },
          ]
        : []
    ),
  });
}
