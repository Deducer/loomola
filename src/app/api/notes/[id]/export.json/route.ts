import { NextResponse } from "next/server";
import { enableGranola } from "@/lib/feature-flags";
import { requireAuth } from "@/lib/require-auth";
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

  return NextResponse.json(payload, {
    headers: downloadHeaders(payload, "application/json; charset=utf-8"),
  });
}
