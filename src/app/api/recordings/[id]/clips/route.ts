import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/require-auth";
import { db } from "@/db";
import { mediaObjects } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { parseClipReference } from "@/lib/recordings/clip-reference";
import {
  appendClipBlockReason,
  getAppendClipSource,
  getAppendClipTarget,
} from "@/db/queries/recording-clips";
import { enqueueAppendClip } from "@/lib/queue/boss";

type AppendClipBody = {
  clipId?: string;
  clipUrl?: string;
  query?: string;
};

const ERROR_MESSAGES: Record<string, string> = {
  target_not_found: "Recording not found.",
  target_not_video: "Only video recordings can have clips appended.",
  target_not_ready: "Wait for this recording to finish processing first.",
  target_missing_composite: "This recording is missing a playable composite.",
  target_missing_duration: "This recording is missing duration metadata.",
  target_trim_active: "Clear the trim before adding a clip.",
  clip_not_found: "Clip not found.",
  clip_not_video: "Only video recordings can be added as clips.",
  clip_not_ready: "That clip is still processing.",
  clip_missing_composite: "That clip is missing a playable composite.",
  clip_missing_duration: "That clip is missing duration metadata.",
  clip_trim_active: "Trimmed clips cannot be added yet.",
  clip_same_recording: "Choose a different recording to add as a clip.",
  invalid_clip_reference: "Choose a clip from your recordings.",
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth(request);
  const { id } = await params;
  const body = (await request.json()) as AppendClipBody;

  const clipReference = parseClipReference(
    body.clipId ?? body.clipUrl ?? body.query ?? ""
  );
  if (!clipReference) {
    return errorResponse("invalid_clip_reference", 400);
  }

  const [target, clip] = await Promise.all([
    getAppendClipTarget({ ownerId: user.id, targetId: id }),
    getAppendClipSource({ ownerId: user.id, reference: clipReference }),
  ]);

  const targetReason = appendClipBlockReason(target);
  if (targetReason) return errorResponse(`target_${targetReason}`, statusFor(targetReason));

  const clipReason = appendClipBlockReason(clip);
  if (clipReason) return errorResponse(`clip_${clipReason}`, statusFor(clipReason));
  if (!target || !clip) return errorResponse("clip_not_found", 404);
  if (clip.id === target.id) return errorResponse("clip_same_recording", 400);

  await db
    .update(mediaObjects)
    .set({ status: "processing", updatedAt: sql`now()` })
    .where(and(eq(mediaObjects.id, target.id), eq(mediaObjects.ownerId, user.id)));

  try {
    await enqueueAppendClip({
      ownerId: user.id,
      targetId: target.id,
      clipId: clip.id,
    });
  } catch (err) {
    await db
      .update(mediaObjects)
      .set({ status: "ready", updatedAt: sql`now()` })
      .where(and(eq(mediaObjects.id, target.id), eq(mediaObjects.ownerId, user.id)));
    console.error(`[append-clip] enqueue failed for ${target.id}:`, err);
    return NextResponse.json({ error: "enqueue_failed" }, { status: 500 });
  }

  return NextResponse.json(
    { ok: true, status: "processing", clipId: clip.id },
    { status: 202 }
  );
}

function errorResponse(error: string, status: number): NextResponse {
  return NextResponse.json(
    { error, message: ERROR_MESSAGES[error] ?? "Could not add that clip." },
    { status }
  );
}

function statusFor(reason: string): number {
  if (reason === "not_found") return 404;
  if (reason === "not_ready") return 409;
  return 400;
}
