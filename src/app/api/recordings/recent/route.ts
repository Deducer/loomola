import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/require-auth";
import { recentMediaItems } from "@/lib/recordings/queries";

/// Slim list of recent recordings for the desktop app's idle home
/// strip. Mirrors the dashboard's listRecordings query but returns
/// only the fields the desktop needs and inlines a signed thumbnail
/// URL so the desktop doesn't N+1.
///
/// Query: ?limit=N (default 8, capped at 50)
///        ?kind=video|audio (optional; filters before applying limit)
///        ?offset=N (default 0; createdAt-desc pagination for the
///          desktop's "Show more" — offset paging is fine here because
///          new recordings only prepend and duplicates are deduped
///          client-side by id)
///
/// `thumbnailUrl` semantics:
///   • video → composite thumbnail (signed R2 URL) or null
///   • audio → first image attachment (signed R2 URL) or null —
///     never the auto-generated waveform PNG, which is decorative
///     noise. The desktop renders a paper icon when null.
///
/// `folderId` / `folderName`: included so the desktop's Recent rows
///   can render a folder pill without a second round trip. Null when
///   the recording isn't filed.
export async function GET(request: Request) {
  const user = await requireAuth(request);

  const url = new URL(request.url);
  const requested = Number.parseInt(url.searchParams.get("limit") ?? "8", 10);
  const limit = Math.min(50, Math.max(1, Number.isFinite(requested) ? requested : 8));
  const kind = url.searchParams.get("kind");
  if (kind !== null && kind !== "video" && kind !== "audio") {
    return NextResponse.json({ error: "invalid_kind" }, { status: 400 });
  }
  const requestedOffset = Number.parseInt(url.searchParams.get("offset") ?? "0", 10);
  const offset = Math.min(1000, Math.max(0, Number.isFinite(requestedOffset) ? requestedOffset : 0));

  const items = (await recentMediaItems({
    ownerId: user.id,
    type: kind ?? undefined,
    limit,
    offset,
    includeSummary: false,
  })).map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    kind: r.type,
    createdAt: r.createdAt.toISOString(),
    durationSeconds: r.durationSeconds,
    status: r.status,
    transcriptReady: r.transcriptReady,
    thumbnailUrl: r.thumbnailUrl,
    folderId: r.folderId,
    folderName: r.folderName,
    attendees: r.attendees,
  }));

  return NextResponse.json({ items });
}
