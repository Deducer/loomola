import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/require-auth";
import { searchRecordings } from "@/db/queries/search";

/// Slim full-text search for the desktop sidebar (⌘K). Reuses the
/// dashboard's tsvector search (titles + AI summaries + transcripts +
/// attendee names) across BOTH media types, ranked, newest-first on
/// ties. Returns only what a result row needs — the desktop opens the
/// note workspace (audio) or the share page (video) from here.
///
/// Query: ?q=<websearch query, min 2 chars> &limit=N (default 15, cap 30)
export async function GET(request: Request) {
  const user = await requireAuth(request);
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length < 2) {
    return NextResponse.json({ items: [] });
  }
  const requested = Number.parseInt(url.searchParams.get("limit") ?? "15", 10);
  const limit = Math.min(30, Math.max(1, Number.isFinite(requested) ? requested : 15));

  const [videos, audios] = await Promise.all([
    searchRecordings({ ownerId: user.id, type: "video", query: q, limit }),
    searchRecordings({ ownerId: user.id, type: "audio", query: q, limit }),
  ]);

  // Interleave by recency — rank isn't comparable across the two calls.
  const items = [...videos, ...audios]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, limit)
    .map((r) => ({
      id: r.id,
      slug: r.slug,
      title: r.aiTitle ?? r.title ?? "Untitled",
      kind: r.type,
      createdAt: r.createdAt.toISOString(),
      durationSeconds: r.durationSeconds == null ? null : Number(r.durationSeconds),
      status: r.status,
    }));

  return NextResponse.json({ items });
}
