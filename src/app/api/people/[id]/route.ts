import { NextResponse } from "next/server";
import { z } from "zod";
import { deletePerson, getPerson, updatePerson } from "@/db/queries/people";
import { enableGranola } from "@/lib/feature-flags";
import { requireAuth } from "@/lib/require-auth";

const updatePersonSchema = z.object({
  displayName: z.string().trim().min(1).max(160).optional(),
  email: z.string().trim().email().nullable().optional(),
  notes: z.string().nullable().optional(),
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

  const row = await getPerson(id, user.id);
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(row, { status: 200 });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!enableGranola()) return granolaNotFound();
  const user = await requireAuth(request);
  const { id } = await params;

  const json = await request.json().catch(() => ({}));
  const parsed = updatePersonSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "body_invalid" }, { status: 400 });
  }

  const row = await updatePerson(id, user.id, parsed.data);
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(row, { status: 200 });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!enableGranola()) return granolaNotFound();
  const user = await requireAuth(request);
  const { id } = await params;

  const removed = await deletePerson(id, user.id);
  return NextResponse.json({ removed }, { status: 200 });
}
