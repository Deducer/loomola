import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/require-auth";
import { applySpeakerSuggestion } from "@/db/queries/speaker-suggestion";
import { getPerson } from "@/db/queries/people";

const bodySchema = z
  .object({
    speakerIdx: z.number().int().min(0),
    personId: z.string().uuid().optional(),
    transcriptVersion: z.string().max(120).nullable().optional(),
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

  if (parsed.data.personId) {
    // Verify the supplied personId belongs to this user.
    const person = await getPerson(parsed.data.personId, user.id);
    if (!person) {
      return NextResponse.json(
        { error: "person_not_found" },
        { status: 404 }
      );
    }
  }

  // Validation and (for a new-person suggestion) the person insert happen
  // in one locked transaction, so a refused accept creates nothing.
  const common = {
    mediaObjectId: id,
    ownerId: user.id,
    speakerIdx: parsed.data.speakerIdx,
    displayLabelOverride: null,
    transcriptVersion: parsed.data.transcriptVersion ?? null,
  };
  const result = parsed.data.createPerson
    ? await applySpeakerSuggestion({
        ...common,
        createPerson: {
          displayName: parsed.data.createPerson.displayName,
          email: parsed.data.createPerson.email ?? null,
        },
      })
    : await applySpeakerSuggestion({ ...common, personId: parsed.data.personId! });
  const personId = result.personId ?? null;

  if (
    !result.ok &&
    (result.reason === "transcript_changed" ||
      result.reason === "transcript_version_required" ||
      result.reason === "suggestion_changed")
  ) {
    // The suggestion (or the screen) is for a transcript that has since
    // been replaced; voice indices may mean someone else now.
    return NextResponse.json({ error: result.reason }, { status: 409 });
  }
  if (!result.ok) {
    // No pending is_suggestion row for that (recording, speakerIdx).
    return NextResponse.json(
      { error: "no_pending_suggestion" },
      { status: 409 }
    );
  }

  return NextResponse.json({ ok: true, personId });
}
