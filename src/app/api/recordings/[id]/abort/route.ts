import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/require-auth";
import { getRecordingOwned } from "@/db/queries/recordings";
import { abortMultipartUpload } from "@/lib/r2/multipart";
import { db } from "@/db";
import { mediaObjects } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import type { TrackKind } from "@/lib/recording/types";

type UploadMeta = {
  [K in TrackKind]?: { uploadId: string; key: string };
} & {
  resumeSegment?: { index: number; startedAt: string; previousStatus?: string };
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth(request);
  const { id } = await params;

  const recording = await getRecordingOwned(id, user.id);
  if (!recording) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const meta = recording.uploadMetadata as UploadMeta | null;
  if (meta) {
    const aborts: Promise<void>[] = [];
    for (const [kind, trackMeta] of Object.entries(meta)) {
      if (kind === "resumeSegment" || !trackMeta) continue;
      const upload = trackMeta as { uploadId: string; key: string };
      aborts.push(abortMultipartUpload(upload.key, upload.uploadId));
    }
    await Promise.all(aborts);
  }

  // Resume after Stop was discarded: the note itself is untouched, so
  // put it back in the state it had before the extra segment began.
  if (meta?.resumeSegment) {
    const previous = meta.resumeSegment.previousStatus === "failed" ? "failed" : "ready";
    await db
      .update(mediaObjects)
      .set({ status: previous, uploadMetadata: null })
      .where(
        and(eq(mediaObjects.id, recording.id), eq(mediaObjects.ownerId, user.id))
      );
    return NextResponse.json({ ok: true, resumed: true });
  }

  // Discard semantics: a user-initiated abort means "this never
  // happened, scrub it." Soft-delete the row so it disappears from
  // Recent / dashboard / search instead of lingering as an
  // "Untitled / failed" ghost the user has to delete by hand.
  // 30-day trash recovery still applies — the row sticks around
  // in the DB but listRecordings filters on deletedAt IS NULL.
  await db
    .update(mediaObjects)
    .set({
      status: "failed",
      uploadMetadata: null,
      deletedAt: new Date(),
    })
    .where(
      and(eq(mediaObjects.id, recording.id), eq(mediaObjects.ownerId, user.id))
    );

  return NextResponse.json({ ok: true });
}
