import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/require-auth";
import { db } from "@/db";
import { mediaObjects } from "@/db/schema";
import { generateSlug } from "@/lib/slug";
import { createMultipartUpload } from "@/lib/r2/multipart";
import { keyForTrack } from "@/lib/recording/upload-keys";
import type { TrackKind } from "@/lib/recording/types";
import { enableGranola } from "@/lib/feature-flags";

type StartRequest = {
  type?: "video" | "audio";
  tracks: Array<{ kind: TrackKind; mimeType: string }>;
  resolution?: string;
  durationEstimate?: number;
  brandProfileId: string | null;
  title?: string | null;
  meetingDetectedApp?: string | null;
  meetingStartedAtLocal?: string | null;
  attendees?: string[];
  sourceContextHint?: string | null;
};

type StartResponse = {
  recordingId: string;
  slug: string;
  uploads: Partial<Record<TrackKind, { key: string; uploadId: string }>>;
};

export async function POST(request: Request) {
  const user = await requireAuth(request);
  const body = (await request.json()) as StartRequest;
  const type = body.type ?? "video";

  if (!Array.isArray(body.tracks) || body.tracks.length === 0) {
    return NextResponse.json({ error: "No tracks specified" }, { status: 400 });
  }
  if (type !== "video" && type !== "audio") {
    return NextResponse.json({ error: "Invalid media type" }, { status: 400 });
  }
  if (type === "audio" && !enableGranola()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const allowedTracks =
    type === "audio"
      ? new Set<TrackKind>(["mic", "system-audio"])
      : new Set<TrackKind>(["composite", "screen", "camera", "mic", "system-audio"]);
  for (const track of body.tracks) {
    if (!allowedTracks.has(track.kind)) {
      return NextResponse.json(
        { error: `Track ${track.kind} is not valid for ${type}` },
        { status: 400 }
      );
    }
  }
  if (type === "video" && !body.tracks.some((track) => track.kind === "composite")) {
    return NextResponse.json(
      { error: "Composite track required" },
      { status: 400 }
    );
  }
  const meetingStartedAtLocal =
    type === "audio" && body.meetingStartedAtLocal
      ? new Date(body.meetingStartedAtLocal)
      : null;
  if (
    meetingStartedAtLocal &&
    Number.isNaN(meetingStartedAtLocal.getTime())
  ) {
    return NextResponse.json(
      { error: "Invalid meetingStartedAtLocal" },
      { status: 400 }
    );
  }

  const slug = generateSlug();
  const uploads: StartResponse["uploads"] = {};
  const uploadMetadata: Record<string, { uploadId: string; key: string }> = {};

  for (const track of body.tracks) {
    const key = keyForTrack(slug, track.kind, track.mimeType);
    const uploadId = await createMultipartUpload(key, track.mimeType);
    uploads[track.kind] = { key, uploadId };
    uploadMetadata[track.kind] = { uploadId, key };
  }

  const [row] = await db
    .insert(mediaObjects)
    .values({
      ownerId: user.id,
      type,
      slug,
      title: body.title?.trim() || null,
      status: "uploading",
      brandProfileId: body.brandProfileId,
      meetingDetectedApp: type === "audio" ? body.meetingDetectedApp ?? null : null,
      meetingStartedAtLocal,
      attendees: type === "audio" ? body.attendees ?? null : null,
      sourceContextHint: type === "audio" ? body.sourceContextHint ?? null : null,
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
