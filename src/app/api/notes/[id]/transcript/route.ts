import { NextResponse } from "next/server";
import { loadNoteExportPayload } from "@/lib/notes/export-route";
import { enableGranola } from "@/lib/feature-flags";
import { requireAuth } from "@/lib/require-auth";

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
  const payload = await loadNoteExportPayload({
    identifier: id,
    ownerId: user.id,
    requestUrl: request.url,
  });

  if (!payload) return granolaNotFound();

  return NextResponse.json(
    {
      fullText: payload.transcript.fullText,
      language: payload.transcript.language,
      provider: payload.transcript.provider,
      paragraphs: payload.transcript.paragraphs,
    },
    { status: 200 }
  );
}
