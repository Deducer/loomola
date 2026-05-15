import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/require-auth";
import {
  softDeleteRecording,
  updateRecordingTitle,
} from "@/db/queries/recordings";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth(request);
  const { id } = await params;
  const ok = await softDeleteRecording(id, user.id);
  if (!ok) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

const titleSchema = z.object({
  title: z.string().min(1).max(200),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth(request);
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const parsed = titleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_title" }, { status: 400 });
  }
  const ok = await updateRecordingTitle({
    id,
    ownerId: user.id,
    title: parsed.data.title,
  });
  if (!ok) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
