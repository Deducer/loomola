import { NextResponse } from "next/server";
import { z } from "zod";
import {
  deleteNotes,
  getNotesByMediaObject,
  upsertNotesBody,
} from "@/db/queries/notes";
import { enableGranola } from "@/lib/feature-flags";
import { requireAuth } from "@/lib/require-auth";

const noteBodySchema = z.object({
  body: z.string(),
});

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

  const row = await getNotesByMediaObject(id, user.id);
  return NextResponse.json(row ?? { body: "" }, { status: 200 });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!enableGranola()) return granolaNotFound();
  const user = await requireAuth(request);
  const { id } = await params;

  const json = await request.json().catch(() => ({}));
  const parsed = noteBodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "body_required" }, { status: 400 });
  }

  try {
    const row = await upsertNotesBody(id, user.id, parsed.data.body);
    return NextResponse.json(row, { status: 200 });
  } catch {
    return NextResponse.json(
      { error: "media_object_not_found" },
      { status: 404 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!enableGranola()) return granolaNotFound();
  const user = await requireAuth(request);
  const { id } = await params;

  const removed = await deleteNotes(id, user.id);
  return NextResponse.json({ removed }, { status: 200 });
}
