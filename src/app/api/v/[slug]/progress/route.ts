import { NextResponse } from "next/server";
import { getRecordingBySlug } from "@/db/queries/recordings";
import { updateProgress } from "@/db/queries/views";
import { hashVisitor } from "@/lib/viewer/visitor-id";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const body = (await request.json().catch(() => ({}))) as { t?: number };
  const t =
    typeof body.t === "number" && isFinite(body.t) && body.t >= 0 ? body.t : 0;
  const rec = await getRecordingBySlug(slug);
  if (!rec) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const visitorHash = hashVisitor(request);
  await updateProgress({
    mediaObjectId: rec.id,
    visitorHash,
    currentTimeSec: t,
  });
  return NextResponse.json({ ok: true });
}
