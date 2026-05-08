import { NextResponse } from "next/server";
import { enableGranola } from "@/lib/feature-flags";
import { requireAuth } from "@/lib/require-auth";
import { listNoteTemplates } from "@/lib/ai/note-templates";

function granolaNotFound() {
  return NextResponse.json({ error: "not_found" }, { status: 404 });
}

export async function GET(request: Request) {
  if (!enableGranola()) return granolaNotFound();
  await requireAuth(request);

  return NextResponse.json({ templates: listNoteTemplates() });
}
