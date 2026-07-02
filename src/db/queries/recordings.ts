import { db } from "@/db";
import { mediaObjects, brandProfiles, aiOutputs, comments } from "@/db/schema";
import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { presignGet } from "@/lib/r2/presigned-get";

export type Recording = typeof mediaObjects.$inferSelect;

export type RecordingBrand = {
  id: string;
  name: string;
  accentColor: string;
  logoUrl: string | null;
  logoUrlDark: string | null;
  // Layer 2 — full-page theming on share pages.
  tagline: string | null;
  fontFamily: string | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
  footerText: string | null;
  defaultTheme: "light" | "dark" | null;
};

export type RecordingWithBrand = Recording & {
  brand: RecordingBrand | null;
  aiTitle: string | null;
  aiSummary: string | null;
  aiChapters: Array<{ start_sec: number; title: string }> | null;
  aiActionItems: Array<{ text: string; timestamp_sec: number }> | null;
  viewCount: number;
  commentCount: number;
};

export type RecordingListItem = Pick<
  Recording,
  | "id"
  | "type"
  | "slug"
  | "title"
  | "status"
  | "failureReason"
  | "durationSeconds"
  | "r2CompositeKey"
  | "compositeThumbnailKey"
  | "folderId"
  | "attendees"
  | "suggestedFolderId"
  | "createdAt"
> & {
  brand: Pick<RecordingBrand, "id" | "name" | "accentColor"> | null;
  aiTitle: string | null;
  viewCount: number;
  commentCount: number;
};

type BrandJoinFields = {
  brandId: string | null;
  brandName: string | null;
  brandAccent: string | null;
  brandLogoUrl: string | null;
  brandLogoR2Key: string | null;
  brandLogoR2KeyDark: string | null;
  brandTagline: string | null;
  brandFontFamily: string | null;
  brandCtaLabel: string | null;
  brandCtaUrl: string | null;
  brandFooterText: string | null;
  brandDefaultTheme: string | null;
};

const BRAND_SELECT = {
  brandId: brandProfiles.id,
  brandName: brandProfiles.name,
  brandAccent: brandProfiles.accentColor,
  brandLogoUrl: brandProfiles.logoUrl,
  brandLogoR2Key: brandProfiles.logoR2Key,
  brandLogoR2KeyDark: brandProfiles.logoR2KeyDark,
  brandTagline: brandProfiles.tagline,
  brandFontFamily: brandProfiles.fontFamily,
  brandCtaLabel: brandProfiles.ctaLabel,
  brandCtaUrl: brandProfiles.ctaUrl,
  brandFooterText: brandProfiles.footerText,
  brandDefaultTheme: brandProfiles.defaultTheme,
} as const;

/**
 * Resolves the joined brand columns into a render-ready brand shape:
 * - logoUrl: presigned R2 URL when logo_r2_key is set, else legacy logo_url
 * - logoUrlDark: presigned R2 URL when logo_r2_key_dark is set, else null
 *
 * Existing /branding/* paths in legacy logo_url keep working untouched.
 */
async function resolveBrand(row: BrandJoinFields): Promise<RecordingBrand | null> {
  if (!row.brandId) return null;
  const [logoUrl, logoUrlDark] = await Promise.all([
    row.brandLogoR2Key
      ? presignGet(row.brandLogoR2Key)
      : Promise.resolve(row.brandLogoUrl),
    row.brandLogoR2KeyDark
      ? presignGet(row.brandLogoR2KeyDark)
      : Promise.resolve(null),
  ]);
  const dt = row.brandDefaultTheme;
  return {
    id: row.brandId,
    name: row.brandName!,
    accentColor: row.brandAccent!,
    logoUrl,
    logoUrlDark,
    tagline: row.brandTagline,
    fontFamily: row.brandFontFamily,
    ctaLabel: row.brandCtaLabel,
    ctaUrl: row.brandCtaUrl,
    footerText: row.brandFooterText,
    defaultTheme: dt === "light" || dt === "dark" ? dt : null,
  };
}

export async function listRecordings(
  ownerId: string
): Promise<RecordingWithBrand[]> {
  const rows = await db
    .select({
      rec: mediaObjects,
      ...BRAND_SELECT,
      aiTitle: aiOutputs.titleSuggested,
      aiSummary: aiOutputs.summary,
      aiChapters: aiOutputs.chapters,
      aiActionItems: aiOutputs.actionItems,
      commentCount: sql<number>`(
        SELECT count(*)::int FROM ${comments}
        WHERE ${comments.mediaObjectId} = ${mediaObjects.id}
      )`.as("comment_count"),
    })
    .from(mediaObjects)
    .leftJoin(brandProfiles, eq(mediaObjects.brandProfileId, brandProfiles.id))
    .leftJoin(aiOutputs, eq(aiOutputs.mediaObjectId, mediaObjects.id))
    .where(
      and(eq(mediaObjects.ownerId, ownerId), isNull(mediaObjects.deletedAt))
    )
    .orderBy(desc(mediaObjects.createdAt));

  const { listViewCounts } = await import("@/db/queries/views");
  const counts = await listViewCounts(rows.map((r) => r.rec.id));

  return Promise.all(
    rows.map(async (r) => ({
      ...r.rec,
      brand: await resolveBrand(r),
      aiTitle: r.aiTitle,
      aiSummary: r.aiSummary,
      aiChapters: r.aiChapters as RecordingWithBrand["aiChapters"],
      aiActionItems: r.aiActionItems as RecordingWithBrand["aiActionItems"],
      viewCount: counts[r.rec.id] ?? 0,
      commentCount: r.commentCount ?? 0,
    }))
  );
}

export async function getRecordingBySlug(
  slug: string
): Promise<RecordingWithBrand | null> {
  const [row] = await db
    .select({
      rec: mediaObjects,
      ...BRAND_SELECT,
      aiTitle: aiOutputs.titleSuggested,
      aiSummary: aiOutputs.summary,
      aiChapters: aiOutputs.chapters,
      aiActionItems: aiOutputs.actionItems,
      commentCount: sql<number>`(
        SELECT count(*)::int FROM ${comments}
        WHERE ${comments.mediaObjectId} = ${mediaObjects.id}
      )`.as("comment_count"),
    })
    .from(mediaObjects)
    .leftJoin(brandProfiles, eq(mediaObjects.brandProfileId, brandProfiles.id))
    .leftJoin(aiOutputs, eq(aiOutputs.mediaObjectId, mediaObjects.id))
    .where(and(eq(mediaObjects.slug, slug), isNull(mediaObjects.deletedAt)))
    .limit(1);

  if (!row) return null;
  const { countViews } = await import("@/db/queries/views");
  const viewCount = await countViews(row.rec.id);
  return {
    ...row.rec,
    brand: await resolveBrand(row),
    aiTitle: row.aiTitle,
    aiSummary: row.aiSummary,
    aiChapters: row.aiChapters as RecordingWithBrand["aiChapters"],
    aiActionItems: row.aiActionItems as RecordingWithBrand["aiActionItems"],
    viewCount,
    commentCount: row.commentCount ?? 0,
  };
}

/**
 * Lightweight slug → recording lookup for high-frequency / utility share-page
 * endpoints (progress pings, view tracking, refresh-url, preview-thumbnails).
 * Selects ONLY the columns those routes read — deliberately NOT
 * aiOutputs.summary (up to 200k chars), chapters/actionItems jsonb, the brand
 * join, the comment-count subquery, or the viewCount round-trip that the full
 * getRecordingBySlug pulls. getRecordingBySlug was being called on every 5s
 * progress beacon during playback, dragging the entire summary out of Postgres
 * each time — a dominant Supabase egress source. Use the fat lookup only for
 * the share-page render itself.
 */
export async function getRecordingRefBySlug(slug: string) {
  const [row] = await db
    .select({
      id: mediaObjects.id,
      ownerId: mediaObjects.ownerId,
      title: mediaObjects.title,
      aiTitle: aiOutputs.titleSuggested,
      status: mediaObjects.status,
      passwordHash: mediaObjects.passwordHash,
      playbackMp4Key: mediaObjects.playbackMp4Key,
      r2CompositeKey: mediaObjects.r2CompositeKey,
      previewSpriteKey: mediaObjects.previewSpriteKey,
      durationSeconds: mediaObjects.durationSeconds,
    })
    .from(mediaObjects)
    .leftJoin(aiOutputs, eq(aiOutputs.mediaObjectId, mediaObjects.id))
    .where(and(eq(mediaObjects.slug, slug), isNull(mediaObjects.deletedAt)))
    .limit(1);
  return row ?? null;
}

export async function getRecordingOwned(
  id: string,
  ownerId: string
): Promise<Recording | null> {
  const [row] = await db
    .select()
    .from(mediaObjects)
    .where(and(eq(mediaObjects.id, id), eq(mediaObjects.ownerId, ownerId)))
    .limit(1);
  return row ?? null;
}

export async function softDeleteRecording(
  id: string,
  ownerId: string
): Promise<boolean> {
  const result = await db
    .update(mediaObjects)
    .set({ deletedAt: sql`now()` })
    .where(and(eq(mediaObjects.id, id), eq(mediaObjects.ownerId, ownerId)))
    .returning({ id: mediaObjects.id });
  return result.length > 0;
}

export async function softDeleteRecordings(
  ids: string[],
  ownerId: string
): Promise<number> {
  if (ids.length === 0) return 0;
  const result = await db
    .update(mediaObjects)
    .set({ deletedAt: sql`now()` })
    .where(and(eq(mediaObjects.ownerId, ownerId), inArray(mediaObjects.id, ids)))
    .returning({ id: mediaObjects.id });
  return result.length;
}

export async function restoreRecording(
  id: string,
  ownerId: string
): Promise<boolean> {
  const result = await db
    .update(mediaObjects)
    .set({ deletedAt: null })
    .where(
      and(
        eq(mediaObjects.id, id),
        eq(mediaObjects.ownerId, ownerId),
        isNotNull(mediaObjects.deletedAt)
      )
    )
    .returning({ id: mediaObjects.id });
  return result.length > 0;
}

export type TrashedRecording = {
  id: string;
  slug: string;
  type: "video" | "audio";
  title: string | null;
  aiTitle: string | null;
  status: string;
  durationSeconds: string | null;
  deletedAt: Date;
  createdAt: Date;
};

export async function listTrashedRecordings(
  ownerId: string
): Promise<TrashedRecording[]> {
  const rows = await db
    .select({
      id: mediaObjects.id,
      slug: mediaObjects.slug,
      type: mediaObjects.type,
      title: mediaObjects.title,
      aiTitle: aiOutputs.titleSuggested,
      status: mediaObjects.status,
      durationSeconds: mediaObjects.durationSeconds,
      deletedAt: mediaObjects.deletedAt,
      createdAt: mediaObjects.createdAt,
    })
    .from(mediaObjects)
    .leftJoin(aiOutputs, eq(aiOutputs.mediaObjectId, mediaObjects.id))
    .where(
      and(eq(mediaObjects.ownerId, ownerId), isNotNull(mediaObjects.deletedAt))
    )
    .orderBy(desc(mediaObjects.deletedAt))
    .limit(200);
  // deletedAt is non-null by the WHERE clause; narrow the inferred type.
  return rows.flatMap((row) =>
    row.deletedAt === null ? [] : [{ ...row, deletedAt: row.deletedAt }]
  );
}

export async function updateTrim(params: {
  id: string;
  ownerId: string;
  startSec: number;
  endSec: number;
}): Promise<boolean> {
  const result = await db
    .update(mediaObjects)
    .set({
      trimStartSec: String(params.startSec),
      trimEndSec: String(params.endSec),
    })
    .where(
      and(eq(mediaObjects.id, params.id), eq(mediaObjects.ownerId, params.ownerId))
    )
    .returning({ id: mediaObjects.id });
  return result.length > 0;
}

export async function clearTrim(params: {
  id: string;
  ownerId: string;
}): Promise<boolean> {
  const result = await db
    .update(mediaObjects)
    .set({ trimStartSec: null, trimEndSec: null })
    .where(
      and(eq(mediaObjects.id, params.id), eq(mediaObjects.ownerId, params.ownerId))
    )
    .returning({ id: mediaObjects.id });
  return result.length > 0;
}

export async function getRecordingForEdit(
  id: string,
  ownerId: string
): Promise<RecordingWithBrand | null> {
  const [row] = await db
    .select({
      rec: mediaObjects,
      ...BRAND_SELECT,
      aiTitle: aiOutputs.titleSuggested,
      aiSummary: aiOutputs.summary,
      aiChapters: aiOutputs.chapters,
      aiActionItems: aiOutputs.actionItems,
      commentCount: sql<number>`(
        SELECT count(*)::int FROM ${comments}
        WHERE ${comments.mediaObjectId} = ${mediaObjects.id}
      )`.as("comment_count"),
    })
    .from(mediaObjects)
    .leftJoin(brandProfiles, eq(mediaObjects.brandProfileId, brandProfiles.id))
    .leftJoin(aiOutputs, eq(aiOutputs.mediaObjectId, mediaObjects.id))
    .where(
      and(
        eq(mediaObjects.id, id),
        eq(mediaObjects.ownerId, ownerId),
        isNull(mediaObjects.deletedAt)
      )
    )
    .limit(1);

  if (!row) return null;
  const { countViews } = await import("@/db/queries/views");
  const viewCount = await countViews(row.rec.id);
  return {
    ...row.rec,
    brand: await resolveBrand(row),
    aiTitle: row.aiTitle,
    aiSummary: row.aiSummary,
    aiChapters: row.aiChapters as RecordingWithBrand["aiChapters"],
    aiActionItems: row.aiActionItems as RecordingWithBrand["aiActionItems"],
    viewCount,
    commentCount: row.commentCount ?? 0,
  };
}

export async function updateRecordingTitle(params: {
  id: string;
  ownerId: string;
  title: string;
}): Promise<boolean> {
  const trimmed = params.title.trim();
  if (trimmed.length === 0 || trimmed.length > 200) return false;
  const result = await db
    .update(mediaObjects)
    .set({ title: trimmed, updatedAt: sql`now()` })
    .where(
      and(
        eq(mediaObjects.id, params.id),
        eq(mediaObjects.ownerId, params.ownerId)
      )
    )
    .returning({ id: mediaObjects.id });
  return result.length > 0;
}

export async function updateRecordingBrand(params: {
  id: string;
  ownerId: string;
  brandProfileId: string | null;
}): Promise<boolean> {
  const result = await db
    .update(mediaObjects)
    .set({ brandProfileId: params.brandProfileId, updatedAt: sql`now()` })
    .where(
      and(
        eq(mediaObjects.id, params.id),
        eq(mediaObjects.ownerId, params.ownerId)
      )
    )
    .returning({ id: mediaObjects.id });
  return result.length > 0;
}

/**
 * Terminal failure: flips status to 'failed' with a human-readable reason.
 * Bumps updated_at so the watchdog's "time since last transition" stays
 * meaningful. Does not overwrite an existing reason with a vaguer one —
 * callers pass the most specific reason they have.
 */
export async function setRecordingFailed(
  id: string,
  reason: string
): Promise<void> {
  await db
    .update(mediaObjects)
    .set({ status: "failed", failureReason: reason, updatedAt: sql`now()` })
    .where(eq(mediaObjects.id, id));
}

/**
 * Records WHY a job failed without flipping status — pg-boss may still
 * retry the job successfully (success paths null the reason out). updated_at
 * is deliberately NOT bumped: the watchdog measures time since the last
 * STATUS transition, and a failing-retrying job must not reset that clock.
 */
export async function recordFailureReason(
  id: string,
  reason: string
): Promise<void> {
  await db
    .update(mediaObjects)
    .set({ failureReason: reason })
    .where(eq(mediaObjects.id, id));
}
