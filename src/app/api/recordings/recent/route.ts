import { NextResponse } from "next/server";
import { listRecordings } from "@/db/queries/recordings";
import { presignGet } from "@/lib/r2/presigned-get";
import { requireAuth } from "@/lib/require-auth";

/// Slim list of recent recordings for the desktop app's idle home
/// strip. Mirrors the dashboard's listRecordings query but returns
/// only the fields the desktop needs and inlines a signed thumbnail
/// URL so the desktop doesn't N+1.
///
/// Query: ?limit=4 (default 4, capped at 12)
export async function GET(request: Request) {
  const user = await requireAuth(request);

  const url = new URL(request.url);
  const requested = Number.parseInt(url.searchParams.get("limit") ?? "4", 10);
  const limit = Math.min(12, Math.max(1, Number.isFinite(requested) ? requested : 4));

  const all = await listRecordings(user.id);
  const slice = all.slice(0, limit);

  const items = await Promise.all(
    slice.map(async (r) => ({
      id: r.id,
      slug: r.slug,
      title: r.aiTitle ?? r.title ?? "Untitled",
      kind: r.type,
      createdAt: r.createdAt.toISOString(),
      // `media_objects.duration_seconds` is a Drizzle `numeric` column,
      // which arrives in JS as a *string* to preserve precision. The
      // desktop client's DTO declares this as `Double?` and decodes
      // strictly, so emitting the raw string makes its JSONDecoder
      // throw and the Recent strip silently shows the empty state.
      // Coerce to a JS number here so the JSON output is a number.
      durationSeconds: r.durationSeconds == null ? null : Number(r.durationSeconds),
      thumbnailUrl: r.compositeThumbnailKey
        ? await presignGet(r.compositeThumbnailKey)
        : null,
    }))
  );

  return NextResponse.json({ items });
}
