import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/require-auth";
import { parseClipReference } from "@/lib/recordings/clip-reference";
import {
  getAppendClipTarget,
  listAppendClipCandidates,
} from "@/db/queries/recording-clips";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth(request);
  const { id } = await params;
  const target = await getAppendClipTarget({ ownerId: user.id, targetId: id });
  if (!target) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim() ?? "";
  const requested = Number.parseInt(url.searchParams.get("limit") ?? "20", 10);
  const limit = Math.min(30, Math.max(1, Number.isFinite(requested) ? requested : 20));
  const reference = parseClipReference(query);

  const items = await listAppendClipCandidates({
    ownerId: user.id,
    targetId: id,
    query,
    reference,
    limit,
  });

  return NextResponse.json({
    items: items.map((item) => ({
      ...item,
      createdAt: item.createdAt.toISOString(),
      creator: user.email ?? "You",
    })),
  });
}
