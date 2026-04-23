import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/require-auth";
import { db } from "@/db";
import { mediaObjects } from "@/db/schema";
import { generateSlug } from "@/lib/slug";
import { createMultipartUpload } from "@/lib/r2/multipart";
import type { TrackKind } from "@/lib/recording/types";

type StartRequest = {
  tracks: Array<{ kind: TrackKind; mimeType: string }>;
  resolution: string;
  durationEstimate?: number;
  brandProfileId: string | null;
};

type StartResponse = {
  recordingId: string;
  slug: string;
  uploads: Partial<Record<TrackKind, { key: string; uploadId: string }>>;
};

function keyFor(slug: string, kind: TrackKind): string {
  const suffix = kind === "composite" ? "composite" : `raw/${kind}`;
  return `${slug}/${suffix}.webm`;
}

export async function POST(request: Request) {
  const user = await requireAuth();
  const body = (await request.json()) as StartRequest;

  if (!Array.isArray(body.tracks) || body.tracks.length === 0) {
    return NextResponse.json({ error: "No tracks specified" }, { status: 400 });
  }

  const slug = generateSlug();
  const uploads: StartResponse["uploads"] = {};
  const uploadMetadata: Record<string, { uploadId: string; key: string }> = {};

  for (const track of body.tracks) {
    const key = keyFor(slug, track.kind);
    const uploadId = await createMultipartUpload(key, track.mimeType);
    uploads[track.kind] = { key, uploadId };
    uploadMetadata[track.kind] = { uploadId, key };
  }

  const [row] = await db
    .insert(mediaObjects)
    .values({
      ownerId: user.id,
      type: "video",
      slug,
      status: "uploading",
      brandProfileId: body.brandProfileId,
      uploadMetadata,
    })
    .returning({ id: mediaObjects.id });

  const response: StartResponse = {
    recordingId: row.id,
    slug,
    uploads,
  };
  return NextResponse.json(response);
}
