import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/require-auth";
import { getRecordingOwned } from "@/db/queries/recordings";
import { completeMultipartUpload } from "@/lib/r2/multipart";
import { db } from "@/db";
import { mediaObjects } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import type { TrackKind } from "@/lib/recording/types";

type CompleteRequest = {
  tracks: Partial<
    Record<TrackKind, Array<{ PartNumber: number; ETag: string }>>
  >;
  durationSeconds: number;
};

type UploadMeta = {
  [K in TrackKind]?: { uploadId: string; key: string };
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth();
  const { id } = await params;
  const body = (await request.json()) as CompleteRequest;

  const recording = await getRecordingOwned(id, user.id);
  if (!recording) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const meta = recording.uploadMetadata as UploadMeta | null;
  if (!meta) {
    return NextResponse.json(
      { error: "No active uploads" },
      { status: 400 }
    );
  }

  const keyUpdates: {
    r2CompositeKey?: string;
    r2ScreenKey?: string;
    r2CameraKey?: string;
    r2MicKey?: string;
    r2SystemaudioKey?: string;
  } = {};

  const completions: Promise<void>[] = [];
  for (const [kind, parts] of Object.entries(body.tracks) as Array<
    [TrackKind, Array<{ PartNumber: number; ETag: string }>]
  >) {
    const trackMeta = meta[kind];
    if (!trackMeta) continue;
    if (!parts || parts.length === 0) continue;
    completions.push(
      completeMultipartUpload(trackMeta.key, trackMeta.uploadId, parts)
    );
    switch (kind) {
      case "composite":
        keyUpdates.r2CompositeKey = trackMeta.key;
        break;
      case "screen":
        keyUpdates.r2ScreenKey = trackMeta.key;
        break;
      case "camera":
        keyUpdates.r2CameraKey = trackMeta.key;
        break;
      case "mic":
        keyUpdates.r2MicKey = trackMeta.key;
        break;
      case "system-audio":
        keyUpdates.r2SystemaudioKey = trackMeta.key;
        break;
    }
  }
  await Promise.all(completions);

  await db
    .update(mediaObjects)
    .set({
      ...keyUpdates,
      durationSeconds: String(body.durationSeconds),
      status: "ready",
      uploadMetadata: null,
    })
    .where(
      and(eq(mediaObjects.id, recording.id), eq(mediaObjects.ownerId, user.id))
    );

  return NextResponse.json({ slug: recording.slug });
}
