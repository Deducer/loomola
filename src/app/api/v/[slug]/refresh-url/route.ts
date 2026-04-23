import { NextResponse } from "next/server";
import { getRecordingBySlug } from "@/db/queries/recordings";
import { presignGet } from "@/lib/r2/presigned-get";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const rec = await getRecordingBySlug(slug);
  if (!rec) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (rec.status !== "ready" || !rec.r2CompositeKey) {
    return NextResponse.json({ error: "not_ready" }, { status: 409 });
  }
  const url = await presignGet(rec.r2CompositeKey);
  return NextResponse.json({ url });
}
