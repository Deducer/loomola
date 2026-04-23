import { db } from "@/db";
import { mediaObjects, brandProfiles } from "@/db/schema";
import { and, desc, eq, isNull, sql } from "drizzle-orm";

export type Recording = typeof mediaObjects.$inferSelect;
export type RecordingWithBrand = Recording & {
  brand: { id: string; name: string; accentColor: string } | null;
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
    })
    .from(mediaObjects)
    .leftJoin(brandProfiles, eq(mediaObjects.brandProfileId, brandProfiles.id))
    .where(
      and(eq(mediaObjects.ownerId, ownerId), isNull(mediaObjects.deletedAt))
    )
    .orderBy(desc(mediaObjects.createdAt));

  return rows.map((r) => ({
    ...r.rec,
    brand: r.brandId
      ? { id: r.brandId, name: r.brandName!, accentColor: r.brandAccent! }
      : null,
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
    })
    .from(mediaObjects)
    .leftJoin(brandProfiles, eq(mediaObjects.brandProfileId, brandProfiles.id))
    .where(and(eq(mediaObjects.slug, slug), isNull(mediaObjects.deletedAt)))
    .limit(1);

  if (!row) return null;
  return {
    ...row.rec,
    brand: row.brandId
      ? { id: row.brandId, name: row.brandName!, accentColor: row.brandAccent! }
      : null,
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
