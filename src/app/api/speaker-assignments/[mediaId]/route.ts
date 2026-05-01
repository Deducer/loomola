import { NextResponse } from "next/server";
import { z } from "zod";
import {
  deleteSpeakerAssignment,
  listSpeakerAssignments,
  upsertSpeakerAssignment,
} from "@/db/queries/speaker-assignments";
import { enableGranola } from "@/lib/feature-flags";
import { requireAuth } from "@/lib/require-auth";

const upsertAssignmentSchema = z
  .object({
    speakerIdx: z.number().int().min(0),
    personId: z.string().uuid().nullable().optional(),
    displayLabelOverride: z.string().trim().min(1).max(160).nullable().optional(),
  })
  .refine(
    (value) => Boolean(value.personId || value.displayLabelOverride),
    "personId_or_displayLabelOverride_required"
  );

function granolaNotFound() {
  return NextResponse.json({ error: "not_found" }, { status: 404 });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ mediaId: string }> }
) {
  if (!enableGranola()) return granolaNotFound();
  const user = await requireAuth(request);
  const { mediaId } = await params;

  const list = await listSpeakerAssignments(mediaId, user.id);
  return NextResponse.json(list, { status: 200 });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ mediaId: string }> }
) {
  if (!enableGranola()) return granolaNotFound();
  const user = await requireAuth(request);
  const { mediaId } = await params;

  const json = await request.json().catch(() => ({}));
  const parsed = upsertAssignmentSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "speaker_assignment_invalid" },
      { status: 400 }
    );
  }

  try {
    const row = await upsertSpeakerAssignment({
      mediaObjectId: mediaId,
      ownerId: user.id,
      speakerIdx: parsed.data.speakerIdx,
      personId: parsed.data.personId ?? null,
      displayLabelOverride: parsed.data.displayLabelOverride ?? null,
    });
    return NextResponse.json(row, { status: 200 });
  } catch {
    return NextResponse.json(
      { error: "speaker_assignment_invalid" },
      { status: 400 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ mediaId: string }> }
) {
  if (!enableGranola()) return granolaNotFound();
  const user = await requireAuth(request);
  const { mediaId } = await params;

  const url = new URL(request.url);
  const speakerIdxRaw = url.searchParams.get("speakerIdx");
  const speakerIdx = speakerIdxRaw ? Number(speakerIdxRaw) : NaN;
  if (!Number.isInteger(speakerIdx)) {
    return NextResponse.json(
      { error: "speaker_idx_required" },
      { status: 400 }
    );
  }

  const removed = await deleteSpeakerAssignment(mediaId, user.id, speakerIdx);
  return NextResponse.json({ removed }, { status: 200 });
}
