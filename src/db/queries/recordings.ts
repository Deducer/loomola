import { db } from "@/db";
import { mediaObjects, brandProfiles, aiOutputs } from "@/db/schema";
import { and, desc, eq, isNull, sql } from "drizzle-orm";

export type Recording = typeof mediaObjects.$inferSelect;

export type RecordingWithBrand = Recording & {
  brand: { id: string; name: string; accentColor: string; logoUrl: string | null } | null;
  aiTitle: string | null;
  aiSummary: string | null;
  aiChapters: Array<{ start_sec: number; title: string }> | null;
  aiActionItems: Array<{ text: string; timestamp_sec: number }> | null;
  viewCount: number;
};

export async function listRecordings(
  ownerId: string
): Promise<RecordingWithBrand[]> {
  const rows = await db
    .select({
      rec: mediaObjects,
      brandId: brandProfiles.id,
      brandName: brandProfiles.name,
      brandAccent: brandProfiles.accentColor,
      brandLogoUrl: brandProfiles.logoUrl,
      aiTitle: aiOutputs.titleSuggested,
      aiSummary: aiOutputs.summary,
      aiChapters: aiOutputs.chapters,
      aiActionItems: aiOutputs.actionItems,
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

  return rows.map((r) => ({
    ...r.rec,
    brand: r.brandId
      ? { id: r.brandId, name: r.brandName!, accentColor: r.brandAccent!, logoUrl: r.brandLogoUrl ?? null }
      : null,
    aiTitle: r.aiTitle,
    aiSummary: r.aiSummary,
    aiChapters: r.aiChapters as RecordingWithBrand["aiChapters"],
    aiActionItems: r.aiActionItems as RecordingWithBrand["aiActionItems"],
    viewCount: counts[r.rec.id] ?? 0,
  }));
}

export async function getRecordingBySlug(
  slug: string
): Promise<RecordingWithBrand | null> {
  const [row] = await db
    .select({
      rec: mediaObjects,
      brandId: brandProfiles.id,
      brandName: brandProfiles.name,
      brandAccent: brandProfiles.accentColor,
      brandLogoUrl: brandProfiles.logoUrl,
      aiTitle: aiOutputs.titleSuggested,
      aiSummary: aiOutputs.summary,
      aiChapters: aiOutputs.chapters,
      aiActionItems: aiOutputs.actionItems,
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
    brand: row.brandId
      ? { id: row.brandId, name: row.brandName!, accentColor: row.brandAccent!, logoUrl: row.brandLogoUrl ?? null }
      : null,
    aiTitle: row.aiTitle,
    aiSummary: row.aiSummary,
    aiChapters: row.aiChapters as RecordingWithBrand["aiChapters"],
    aiActionItems: row.aiActionItems as RecordingWithBrand["aiActionItems"],
    viewCount,
  };
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
      brandId: brandProfiles.id,
      brandName: brandProfiles.name,
      brandAccent: brandProfiles.accentColor,
      brandLogoUrl: brandProfiles.logoUrl,
      aiTitle: aiOutputs.titleSuggested,
      aiSummary: aiOutputs.summary,
      aiChapters: aiOutputs.chapters,
      aiActionItems: aiOutputs.actionItems,
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
    brand: row.brandId
      ? {
          id: row.brandId,
          name: row.brandName!,
          accentColor: row.brandAccent!,
          logoUrl: row.brandLogoUrl ?? null,
        }
      : null,
    aiTitle: row.aiTitle,
    aiSummary: row.aiSummary,
    aiChapters: row.aiChapters as RecordingWithBrand["aiChapters"],
    aiActionItems: row.aiActionItems as RecordingWithBrand["aiActionItems"],
    viewCount,
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
