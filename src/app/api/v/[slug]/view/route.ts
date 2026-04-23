import { NextResponse } from "next/server";
import { getRecordingBySlug } from "@/db/queries/recordings";
import { upsertView } from "@/db/queries/views";
import { hashVisitor } from "@/lib/viewer/visitor-id";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const rec = await getRecordingBySlug(slug);
  if (!rec) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const visitorHash = hashVisitor(request);
  const ua = (request.headers.get("user-agent") ?? "").slice(0, 120);
  await upsertView({
    mediaObjectId: rec.id,
    visitorHash,
    userAgentSummary: ua,
  });
  return NextResponse.json({ ok: true });
}
