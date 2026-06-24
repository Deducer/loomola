import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getRecordingRefBySlug } from "@/db/queries/recordings";
import { getTranscriptWordsByRecording } from "@/db/queries/transcripts";
import { cookieName, verifyUnlockToken } from "@/lib/viewer/unlock-cookie";
import { getOptionalAuthUser } from "@/lib/require-auth";

/**
 * Word-timing array for the interactive transcript panel, fetched lazily by
 * TranscriptPanel only once it scrolls into view. Kept out of the share-page
 * server render so viewers who never reach the transcript don't pull the
 * (often very large) wordTimestamps blob out of Postgres. Mirrors the share
 * page's password gate so locked recordings don't leak the transcript.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const rec = await getRecordingRefBySlug(slug);
  if (!rec) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const user = await getOptionalAuthUser(request);
  const isOwner = !!user && user.id === rec.ownerId;

  if (rec.passwordHash && !isOwner) {
    const jar = await cookies();
    const token = jar.get(cookieName(slug))?.value ?? "";
    const unlocked = verifyUnlockToken({
      slug,
      passwordHash: rec.passwordHash,
      token,
    });
    if (!unlocked) return NextResponse.json({ error: "locked" }, { status: 403 });
  }

  const words = await getTranscriptWordsByRecording(rec.id);
  return NextResponse.json(
    { words },
    { headers: { "cache-control": "private, max-age=1800" } }
  );
}
