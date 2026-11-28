import { NextResponse } from "next/server";
import { getRecordingRefBySlug } from "@/db/queries/recordings";
import { presignGet } from "@/lib/r2/presigned-get";
import { isUnlockedForStack } from "@/lib/viewer/stack-unlock";
import { getOptionalAuthUser } from "@/lib/require-auth";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const rec = await getRecordingRefBySlug(slug);
  if (!rec) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const playbackKey = rec.playbackMp4Key ?? rec.r2CompositeKey;
  if (rec.status !== "ready" || !playbackKey) {
    return NextResponse.json({ error: "not_ready" }, { status: 409 });
  }
  if (rec.passwordHash) {
    const user = await getOptionalAuthUser(request);
    const isOwner = !!user && user.id === rec.ownerId;

    if (!isOwner && !(await isUnlockedForStack(slug, rec))) {
      return NextResponse.json({ error: "locked" }, { status: 403 });
    }
  }
  const url = await presignGet(playbackKey);
  return NextResponse.json({ url });
}
