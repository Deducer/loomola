import { NextResponse } from "next/server";
import { enableGranola } from "@/lib/feature-flags";
import { buildNoteMarkdown } from "@/lib/notes/export";
import {
  downloadHeaders,
  loadNoteExportPayload,
  resolveNoteExportOwnerId,
} from "@/lib/notes/export-route";

function granolaNotFound() {
  return NextResponse.json({ error: "not_found" }, { status: 404 });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!enableGranola()) return granolaNotFound();
  const { id } = await params;
  const ownerId = await resolveNoteExportOwnerId({ request, identifier: id });
  if (!ownerId) return granolaNotFound();
  const payload = await loadNoteExportPayload({
    identifier: id,
    ownerId,
    requestUrl: request.url,
  });
  if (!payload) return granolaNotFound();

  return new Response(buildNoteMarkdown(payload), {
    headers: downloadHeaders(payload, "text/markdown; charset=utf-8"),
  });
}
