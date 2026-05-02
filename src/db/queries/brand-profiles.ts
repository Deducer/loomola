import { db } from "@/db";
import { brandProfiles } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import type { BrandProfileInput } from "@/lib/validation/brand-profile";
import { presignGet } from "@/lib/r2/presigned-get";

type BrandProfileRow = typeof brandProfiles.$inferSelect;

/**
 * Public-facing brand profile shape. `logoUrl` is the light-mode logo
 * (presigned R2 URL if the brand has logo_r2_key set, else the legacy
 * logo_url column for /branding/* paths and direct URLs). `logoUrlDark`
 * is the dark-mode counterpart, presigned from logo_r2_key_dark when
 * present. UI components fall back to the other variant when one is
 * missing.
 */
export type BrandProfile = Omit<
  BrandProfileRow,
  "logoR2Key" | "logoR2KeyDark"
> & {
  logoR2Key: string | null;
  logoR2KeyDark: string | null;
  logoUrlDark: string | null;
};

async function resolveLogo(row: BrandProfileRow): Promise<BrandProfile> {
  const [logoUrl, logoUrlDark] = await Promise.all([
    row.logoR2Key ? presignGet(row.logoR2Key) : Promise.resolve(row.logoUrl),
    row.logoR2KeyDark ? presignGet(row.logoR2KeyDark) : Promise.resolve(null),
  ]);
  return { ...row, logoUrl, logoUrlDark };
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
  /** Set when the user uploaded a new light-mode logo. */
  logoR2Key?: string | null;
  /** Set when the user uploaded a new dark-mode logo. */
  logoR2KeyDark?: string | null;
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
      logoR2KeyDark: input.logoR2KeyDark ?? null,
      tagline: input.tagline ?? null,
      fontFamily: input.fontFamily ?? null,
      ctaLabel: input.ctaLabel ?? null,
      ctaUrl: input.ctaUrl ?? null,
      footerText: input.footerText ?? null,
      meetingNotesVaultPath: input.meetingNotesVaultPath ?? null,
      defaultTheme: input.defaultTheme ?? null,
    })
    .returning();
  return row;
}

export async function updateBrandProfile(
  id: string,
  ownerId: string,
  input: BrandProfileWrite
): Promise<BrandProfileRow | null> {
  // Preserve any logo column the caller didn't supply (undefined) — saves
  // the text fields without forcing the user to re-upload images.
  const set: Partial<typeof brandProfiles.$inferInsert> = {
    name: input.name,
    accentColor: input.accentColor,
    logoUrl: input.logoUrl ?? null,
    tagline: input.tagline ?? null,
    fontFamily: input.fontFamily ?? null,
    ctaLabel: input.ctaLabel ?? null,
    ctaUrl: input.ctaUrl ?? null,
    footerText: input.footerText ?? null,
    meetingNotesVaultPath: input.meetingNotesVaultPath ?? null,
    defaultTheme: input.defaultTheme ?? null,
  };
  if (input.logoR2Key !== undefined) {
    set.logoR2Key = input.logoR2Key;
    // A new upload supersedes any legacy direct URL.
    if (input.logoR2Key) set.logoUrl = null;
  }
  if (input.logoR2KeyDark !== undefined) {
    set.logoR2KeyDark = input.logoR2KeyDark;
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
