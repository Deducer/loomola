import { NextResponse } from "next/server";
import { getRecordingRefBySlug } from "@/db/queries/recordings";

/// Slim public status for the share page's not-ready view. Lets the page
/// honor its "this page will catch up automatically" promise: the client
/// polls this and refreshes when the pipeline finishes. Status is already
/// visible on the page itself (even password-locked pages show their
/// processing state), so this leaks nothing new.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const rec = await getRecordingRefBySlug(slug);
  if (!rec) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json(
    { status: rec.status },
    { headers: { "cache-control": "private, no-store" } }
  );
}
