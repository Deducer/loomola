import { NextResponse } from "next/server";
import { purgeMediaObjectOwned } from "@/lib/queue/jobs/purge-deleted";
import { requireAuth } from "@/lib/require-auth";

/// Immediate, permanent delete of an already-trashed recording (storage
/// objects + row). Only rows with deleted_at set qualify — the two-step
/// trash → purge shape means one click can never permanently destroy data.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth(request);
  const { id } = await params;
  const purged = await purgeMediaObjectOwned(id, user.id);
  if (!purged) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
