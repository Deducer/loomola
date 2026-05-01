import { NextResponse } from "next/server";
import { z } from "zod";
import { createPerson, listPeople } from "@/db/queries/people";
import { enableGranola } from "@/lib/feature-flags";
import { requireAuth } from "@/lib/require-auth";

const createPersonSchema = z.object({
  displayName: z.string().trim().min(1).max(160),
  email: z.string().trim().email().nullable().optional(),
  notes: z.string().nullable().optional(),
});

function granolaNotFound() {
  return NextResponse.json({ error: "not_found" }, { status: 404 });
}

export async function GET(request: Request) {
  if (!enableGranola()) return granolaNotFound();
  const user = await requireAuth(request);
  const people = await listPeople(user.id);
  return NextResponse.json(people, { status: 200 });
}

export async function POST(request: Request) {
  if (!enableGranola()) return granolaNotFound();
  const user = await requireAuth(request);

  const json = await request.json().catch(() => ({}));
  const parsed = createPersonSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "display_name_required" },
      { status: 400 }
    );
  }

  const row = await createPerson(user.id, parsed.data);
  return NextResponse.json(row, { status: 201 });
}
