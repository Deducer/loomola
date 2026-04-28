import { db } from "@/db";
import { brandProfiles } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import type { BrandProfileInput } from "@/lib/validation/brand-profile";
import { presignGet } from "@/lib/r2/presigned-get";

type BrandProfileRow = typeof brandProfiles.$inferSelect;

/**
 * Public-facing brand profile shape. `logoUrl` is what the UI renders —
 * either a presigned R2 URL (if the brand has an uploaded logo via
 * logo_r2_key) or the legacy logo_url column (used for direct URLs and
 * the static /branding/ paths we manually wired earlier).
 */
export type BrandProfile = Omit<BrandProfileRow, "logoR2Key"> & {
  logoR2Key: string | null;
};

async function resolveLogo(row: BrandProfileRow): Promise<BrandProfile> {
  if (row.logoR2Key) {
    const presigned = await presignGet(row.logoR2Key);
    return { ...row, logoUrl: presigned };
  }
  return row;
}

export async function listBrandProfiles(ownerId: string): Promise<BrandProfile[]> {
  const rows = await db
    .select()
    .from(brandProfiles)
    .where(eq(brandProfiles.ownerId, ownerId))
    .orderBy(desc(brandProfiles.createdAt));
  return Promise.all(rows.map(resolveLogo));
}

export async function getBrandProfile(
  id: string,
  ownerId: string
): Promise<BrandProfile | null> {
  const [row] = await db
    .select()
    .from(brandProfiles)
    .where(and(eq(brandProfiles.id, id), eq(brandProfiles.ownerId, ownerId)))
    .limit(1);
  if (!row) return null;
  return resolveLogo(row);
}

export type BrandProfileWrite = BrandProfileInput & {
  /** Set when the user uploaded a new logo. Stored as the R2 key, presigned at read time. */
  logoR2Key?: string | null;
};

export async function createBrandProfile(
  ownerId: string,
  input: BrandProfileWrite
): Promise<BrandProfileRow> {
  const [row] = await db
    .insert(brandProfiles)
    .values({
      ownerId,
      name: input.name,
      accentColor: input.accentColor,
      logoUrl: input.logoUrl ?? null,
      logoR2Key: input.logoR2Key ?? null,
      tagline: input.tagline ?? null,
      fontFamily: input.fontFamily ?? null,
      ctaLabel: input.ctaLabel ?? null,
      ctaUrl: input.ctaUrl ?? null,
      footerText: input.footerText ?? null,
    })
    .returning();
  return row;
}

export async function updateBrandProfile(
  id: string,
  ownerId: string,
  input: BrandProfileWrite
): Promise<BrandProfileRow | null> {
  // Preserve logo_r2_key when the caller didn't supply one — saves the
  // text fields without forcing the user to re-upload.
  const set: Partial<typeof brandProfiles.$inferInsert> = {
    name: input.name,
    accentColor: input.accentColor,
    logoUrl: input.logoUrl ?? null,
    tagline: input.tagline ?? null,
    fontFamily: input.fontFamily ?? null,
    ctaLabel: input.ctaLabel ?? null,
    ctaUrl: input.ctaUrl ?? null,
    footerText: input.footerText ?? null,
  };
  if (input.logoR2Key !== undefined) {
    set.logoR2Key = input.logoR2Key;
    // A new upload supersedes any legacy direct URL.
    if (input.logoR2Key) set.logoUrl = null;
  }
  const [row] = await db
    .update(brandProfiles)
    .set(set)
    .where(and(eq(brandProfiles.id, id), eq(brandProfiles.ownerId, ownerId)))
    .returning();
  return row ?? null;
}

export async function deleteBrandProfile(
  id: string,
  ownerId: string
): Promise<boolean> {
  const result = await db
    .delete(brandProfiles)
    .where(and(eq(brandProfiles.id, id), eq(brandProfiles.ownerId, ownerId)))
    .returning({ id: brandProfiles.id });
  return result.length > 0;
}
