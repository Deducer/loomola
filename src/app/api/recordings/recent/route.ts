import { NextResponse } from "next/server";
import { listRecordings } from "@/db/queries/recordings";
import { listImageAttachmentsForMediaIds } from "@/db/queries/notes";
import { listFoldersForOwner } from "@/db/queries/folders";
import { db } from "@/db";
import { transcripts } from "@/db/schema";
import { inArray } from "drizzle-orm";
import { presignGet } from "@/lib/r2/presigned-get";
import { requireAuth } from "@/lib/require-auth";

/// Slim list of recent recordings for the desktop app's idle home
/// strip. Mirrors the dashboard's listRecordings query but returns
/// only the fields the desktop needs and inlines a signed thumbnail
/// URL so the desktop doesn't N+1.
///
/// Query: ?limit=N (default 8, capped at 50)
///        ?kind=video|audio (optional; filters before applying limit)
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

  const all = await listRecordings(user.id);
  const filtered = kind === null ? all : all.filter((r) => r.type === kind);
  const slice = filtered.slice(0, limit);

  // One round trip for all audio attachments instead of N+1.
  const audioIds = slice.filter((r) => r.type === "audio").map((r) => r.id);
  const attachments =
    audioIds.length > 0
      ? await listImageAttachmentsForMediaIds(audioIds, user.id)
      : new Map();
  const transcriptLengthByMediaId = new Map<string, number>();
  if (audioIds.length > 0) {
    const transcriptRows = await db
      .select({
        mediaObjectId: transcripts.mediaObjectId,
        textLength: transcripts.fullText,
      })
      .from(transcripts)
      .where(inArray(transcripts.mediaObjectId, audioIds));
    for (const row of transcriptRows) {
      transcriptLengthByMediaId.set(
        row.mediaObjectId,
        row.textLength.trim().length
      );
    }
  }

  // One round trip for folder names. Only fetch when at least one
  // recording in the slice is filed.
  const sliceHasFolder = slice.some((r) => r.folderId != null);
  const folderNameById = new Map<string, string>();
  if (sliceHasFolder) {
    const folders = await listFoldersForOwner(user.id);
    for (const f of folders) folderNameById.set(f.id, f.name);
  }

  const items = await Promise.all(
    slice.map(async (r) => {
      let thumbnailUrl: string | null = null;
      if (r.type === "audio") {
        const list = attachments.get(r.id) ?? [];
        const firstImage = list[0];
        if (firstImage) {
          thumbnailUrl = await presignGet(firstImage.r2Key);
        }
      } else if (r.compositeThumbnailKey) {
        thumbnailUrl = await presignGet(r.compositeThumbnailKey);
      }
      return {
        id: r.id,
        slug: r.slug,
        title: r.aiTitle ?? r.title ?? "Untitled",
        kind: r.type,
        createdAt: r.createdAt.toISOString(),
        // `media_objects.duration_seconds` is a Drizzle `numeric` column
        // → arrives as a string. Coerce to a JS number so the desktop's
        // strict JSONDecoder accepts it as Double.
        durationSeconds: r.durationSeconds == null ? null : Number(r.durationSeconds),
        status: r.status,
        transcriptReady:
          r.type === "audio"
            ? (transcriptLengthByMediaId.get(r.id) ?? 0) > 0
            : null,
        thumbnailUrl,
        folderId: r.folderId,
        folderName: r.folderId ? (folderNameById.get(r.folderId) ?? null) : null,
      };
    })
  );

  return NextResponse.json({ items });
}
