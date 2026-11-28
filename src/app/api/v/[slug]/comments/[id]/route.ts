import { NextResponse } from "next/server";
import { getOptionalAuthUser } from "@/lib/require-auth";
import { getRecordingRefBySlug } from "@/db/queries/recordings";
import { setCommentResolvedOwned } from "@/db/queries/comments";
import { toReviewComment } from "@/lib/review/comments";

/** Owner-only: `{ resolved: boolean }` on a top-level comment. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ slug: string; id: string }> }
) {
  const user = await getOptionalAuthUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { slug, id } = await params;
  const body = (await request.json().catch(() => ({}))) as { resolved?: unknown };
  if (typeof body.resolved !== "boolean") {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const rec = await getRecordingRefBySlug(slug);
  if (!rec || rec.ownerId !== user.id) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const { result, row } = await setCommentResolvedOwned({
    commentId: id,
    ownerId: user.id,
    resolved: body.resolved,
    mediaObjectId: rec.id,
  });
  if (result === "is_reply") {
    return NextResponse.json({ error: "replies_cannot_resolve" }, { status: 400 });
  }
  if (result !== "ok" || !row) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, comment: toReviewComment(row) });
}
