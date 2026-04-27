import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/require-auth";
import { getRecordingOwned } from "@/db/queries/recordings";
import { presignUploadPart } from "@/lib/r2/multipart";
import type { TrackKind } from "@/lib/recording/types";

type PartUrlRequest = {
  track: TrackKind;
  partNumber: number;
};

type UploadMeta = {
  [K in TrackKind]?: { uploadId: string; key: string };
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth(request);
  const { id } = await params;
  const body = (await request.json()) as PartUrlRequest;

  if (!body.track || typeof body.partNumber !== "number") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  if (body.partNumber < 1 || body.partNumber > 10_000) {
    return NextResponse.json(
      { error: "partNumber out of range" },
      { status: 400 }
    );
  }

  const recording = await getRecordingOwned(id, user.id);
  if (!recording) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const meta = recording.uploadMetadata as UploadMeta | null;
  const trackMeta = meta?.[body.track];
  if (!trackMeta) {
    return NextResponse.json(
      { error: `Track ${body.track} has no active upload` },
      { status: 400 }
    );
  }

  const url = await presignUploadPart(
    trackMeta.key,
    trackMeta.uploadId,
    body.partNumber
  );
  return NextResponse.json({ url, partNumber: body.partNumber });
}
