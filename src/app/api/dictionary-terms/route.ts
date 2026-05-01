import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createDictionaryTerm,
  listDictionaryTerms,
} from "@/db/queries/dictionary-terms";
import { enableGranola } from "@/lib/feature-flags";
import { requireAuth } from "@/lib/require-auth";

const createTermSchema = z.object({
  term: z.string().trim().min(1).max(160),
  variantOf: z.string().uuid().nullable().optional(),
});

function granolaNotFound() {
  return NextResponse.json({ error: "not_found" }, { status: 404 });
}

export async function GET(request: Request) {
  if (!enableGranola()) return granolaNotFound();
  const user = await requireAuth(request);
  const list = await listDictionaryTerms(user.id);
  return NextResponse.json(list, { status: 200 });
}

export async function POST(request: Request) {
  if (!enableGranola()) return granolaNotFound();
  const user = await requireAuth(request);

  const json = await request.json().catch(() => ({}));
  const parsed = createTermSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "term_required" }, { status: 400 });
  }

  try {
    const row = await createDictionaryTerm(
      user.id,
      parsed.data.term,
      parsed.data.variantOf ?? null
    );
    return NextResponse.json(row, { status: 201 });
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
