import { NextResponse } from "next/server";
import { z } from "zod";
import {
  deleteDictionaryTerm,
  updateDictionaryTerm,
} from "@/db/queries/dictionary-terms";
import { enableGranola } from "@/lib/feature-flags";
import { requireAuth } from "@/lib/require-auth";

const updateTermSchema = z.object({
  term: z.string().trim().min(1).max(160).optional(),
  variantOf: z.string().uuid().nullable().optional(),
});

function granolaNotFound() {
  return NextResponse.json({ error: "not_found" }, { status: 404 });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!enableGranola()) return granolaNotFound();
  const user = await requireAuth(request);
  const { id } = await params;

  const json = await request.json().catch(() => ({}));
  const parsed = updateTermSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "body_invalid" }, { status: 400 });
  }

  try {
    const row = await updateDictionaryTerm(id, user.id, parsed.data);
    if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json(row, { status: 200 });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      return NextResponse.json(
        { error: "term_already_exists" },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: "variant_not_found" }, { status: 404 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!enableGranola()) return granolaNotFound();
  const user = await requireAuth(request);
  const { id } = await params;

  const removed = await deleteDictionaryTerm(id, user.id);
  return NextResponse.json({ removed }, { status: 200 });
}
