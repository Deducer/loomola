import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/require-auth";
import { applySpeakerSuggestion } from "@/db/queries/speaker-suggestion";
import { createPerson, getPerson } from "@/db/queries/people";

const bodySchema = z
  .object({
    speakerIdx: z.number().int().min(0),
    personId: z.string().uuid().optional(),
    createPerson: z
      .object({
        displayName: z.string().min(1).max(120),
        email: z.string().email().nullable().optional(),
      })
      .optional(),
  })
  .refine(
    (b) => Boolean(b.personId) !== Boolean(b.createPerson),
    "exactly one of personId or createPerson must be provided"
  );

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth(request);
  const { id } = await params;

  const raw = await request.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  let personId = parsed.data.personId ?? null;
  let displayLabelOverride: string | null = null;

  if (parsed.data.createPerson) {
    const created = await createPerson(user.id, {
      displayName: parsed.data.createPerson.displayName,
      email: parsed.data.createPerson.email ?? null,
    });
    personId = created.id;
  } else if (personId) {
    // Verify the supplied personId belongs to this user.
    const person = await getPerson(personId, user.id);
    if (!person) {
      return NextResponse.json(
        { error: "person_not_found" },
        { status: 404 }
      );
    }
    displayLabelOverride = null;
  }

  if (!personId) {
    return NextResponse.json({ error: "missing_person" }, { status: 400 });
  }

  const result = await applySpeakerSuggestion({
    mediaObjectId: id,
    ownerId: user.id,
    speakerIdx: parsed.data.speakerIdx,
    personId,
    displayLabelOverride,
  });

  if (!result.ok) {
    // No pending is_suggestion row for that (recording, speakerIdx).
    return NextResponse.json(
      { error: "no_pending_suggestion" },
      { status: 409 }
    );
  }

  return NextResponse.json({ ok: true, personId });
}
