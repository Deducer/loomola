import { NextResponse } from "next/server";
import { enableGranola } from "@/lib/feature-flags";
import { requireAuth } from "@/lib/require-auth";
import { buildTranscriptMarkdown, noteExportFilename } from "@/lib/notes/export";
import {
  downloadHeaders,
  loadNoteExportPayload,
} from "@/lib/notes/export-route";

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

  return new Response(`${buildTranscriptMarkdown(payload) || "_No transcript yet._"}\n`, {
    headers: downloadHeaders(
      payload,
      "text/markdown; charset=utf-8",
      noteExportFilename(payload, "md").replace(/\.md$/, "-transcript.md")
    ),
  });
}
