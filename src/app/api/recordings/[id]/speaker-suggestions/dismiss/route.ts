import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/require-auth";
import { dismissSpeakerSuggestion } from "@/db/queries/speaker-suggestion";

const bodySchema = z.object({
  speakerIdx: z.number().int().min(0),
  transcriptVersion: z.string().max(120).nullable().optional(),
});

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

  const result = await dismissSpeakerSuggestion({
    mediaObjectId: id,
    ownerId: user.id,
    speakerIdx: parsed.data.speakerIdx,
    transcriptVersion: parsed.data.transcriptVersion ?? null,
  });

  if (!result.ok && result.reason === "transcript_changed") {
    return NextResponse.json({ error: "transcript_changed" }, { status: 409 });
  }
  if (!result.ok) {
    // No pending suggestion at that idx — idempotent OK from caller's view.
    return NextResponse.json({ ok: true, alreadyDismissed: true });
  }

  return NextResponse.json({ ok: true });
}
