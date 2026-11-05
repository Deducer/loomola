import { NextResponse } from "next/server";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { mediaObjects } from "@/db/schema";
import { createMultipartUpload } from "@/lib/r2/multipart";
import { keyForTrack } from "@/lib/recording/upload-keys";
import type { TrackKind } from "@/lib/recording/types";
import { enableGranola } from "@/lib/feature-flags";
import { requireAuth } from "@/lib/require-auth";

function granolaNotFound() {
  return NextResponse.json({ error: "not_found" }, { status: 404 });
}

const AUDIO_MIME = "audio/mp4";

/**
 * Resume after Stop. Opens multipart uploads for one more segment of a
 * saved audio note, using the same track set the note was recorded with
 * so mix_audio can concatenate like with like. The desktop then records,
 * uploads through the usual part-url calls and finishes with
 * /api/recordings/[id]/complete, which sees `resumeSegment` in the upload
 * metadata and appends the segment instead of replacing the note's tracks.
 *
 * Response shape matches /api/recordings/start plus `tracks` (the kinds
 * to capture) and `segmentIndex`.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!enableGranola()) return granolaNotFound();
  const user = await requireAuth(request);
  const { id } = await params;

  const [note] = await db
    .select({
      id: mediaObjects.id,
      slug: mediaObjects.slug,
      status: mediaObjects.status,
      uploadMetadata: mediaObjects.uploadMetadata,
      r2MicKey: mediaObjects.r2MicKey,
      r2SystemaudioKey: mediaObjects.r2SystemaudioKey,
      r2MixedKey: mediaObjects.r2MixedKey,
      audioSegments: mediaObjects.audioSegments,
    })
    .from(mediaObjects)
    .where(
      and(
        eq(mediaObjects.id, id),
        eq(mediaObjects.ownerId, user.id),
        eq(mediaObjects.type, "audio"),
        isNull(mediaObjects.deletedAt)
      )
    )
    .limit(1);
  if (!note) return granolaNotFound();

  const tracks = resumeTracksFor(note);
  if (tracks.length === 0) {
    return NextResponse.json({ error: "audio_source_missing" }, { status: 409 });
  }
  if (note.uploadMetadata || !(note.status === "ready" || note.status === "failed")) {
    return NextResponse.json(
      { error: "note_busy", mediaStatus: note.status },
      { status: 409 }
    );
  }

  const segmentIndex = 2 + (note.audioSegments?.length ?? 0);
  const uploads: Partial<Record<TrackKind, { key: string; uploadId: string }>> = {};
  const uploadMetadata: Record<string, unknown> = {};
  for (const kind of tracks) {
    const key = keyForTrack(note.slug, kind, AUDIO_MIME, segmentIndex);
    const uploadId = await createMultipartUpload(key, AUDIO_MIME);
    uploads[kind] = { key, uploadId };
    uploadMetadata[kind] = { uploadId, key };
  }
  uploadMetadata.resumeSegment = {
    index: segmentIndex,
    startedAt: new Date().toISOString(),
    // Discard (abort) puts the note back where it was instead of
    // trashing it like an abandoned first recording.
    previousStatus: note.status,
  };

  await db
    .update(mediaObjects)
    .set({ uploadMetadata, status: "uploading", updatedAt: sql`now()` })
    .where(eq(mediaObjects.id, note.id));

  return NextResponse.json({
    recordingId: note.id,
    slug: note.slug,
    uploads,
    tracks,
    segmentIndex,
  });
}

/** The track kinds a resumed segment must capture: whatever segment 1 had. */
export function resumeTracksFor(note: {
  r2MicKey: string | null;
  r2SystemaudioKey: string | null;
  r2MixedKey: string | null;
}): TrackKind[] {
  const tracks: TrackKind[] = [];
  if (note.r2MicKey) tracks.push("mic");
  if (note.r2SystemaudioKey) tracks.push("system-audio");
  if (tracks.length === 0 && note.r2MixedKey) tracks.push("mic");
  return tracks;
}
