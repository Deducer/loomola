import { NextResponse } from "next/server";
import { z } from "zod";
import {
  getAudioNoteAccess,
  markObsidianSaveRequested,
} from "@/db/queries/notes";
import { enableGranola } from "@/lib/feature-flags";
import { requireAuth } from "@/lib/require-auth";
import { resolveObsidianPath } from "@/lib/notes/obsidian-path";

const saveSchema = z.object({
  path: z.string().optional().nullable(),
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
  const data = await getAudioNoteAccess(id, user.id);
  if (!data) return granolaNotFound();

  const json = await request.json().catch(() => ({}));
  const parsed = saveSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_path" }, { status: 400 });
  }

  const requested = await markObsidianSaveRequested(data.id, user.id);
  if (!requested) return granolaNotFound();

  return NextResponse.json(
    {
      ok: true,
      status: "queued",
      path: resolveObsidianPath({
        overridePath: parsed.data.path,
        projectPath: data.meetingNotesVaultPath,
      }),
      exportUrl: `/api/notes/${data.id}/export.md`,
    },
    { status: 202 }
  );
}
