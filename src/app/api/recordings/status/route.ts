import { NextResponse } from "next/server";
import { db } from "@/db";
import { mediaObjects } from "@/db/schema";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { requireAuth } from "@/lib/require-auth";

const MAX_IDS = 100;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/// Slim batch status lookup backing the dashboard/edit processing-status
/// polls. Returns only {id, status, failureReason} for the caller's own
/// recordings so a poll tick costs bytes, not rows.
export async function GET(request: Request) {
  const user = await requireAuth(request);
  const url = new URL(request.url);
  const ids = (url.searchParams.get("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => UUID_RE.test(s))
    .slice(0, MAX_IDS);
  if (ids.length === 0) {
    return NextResponse.json({ items: [] });
  }

  const rows = await db
    .select({
      id: mediaObjects.id,
      status: mediaObjects.status,
      failureReason: mediaObjects.failureReason,
    })
    .from(mediaObjects)
    .where(
      and(
        inArray(mediaObjects.id, ids),
        eq(mediaObjects.ownerId, user.id),
        isNull(mediaObjects.deletedAt)
      )
    );

  return NextResponse.json({ items: rows });
}
