import { db } from "@/db";
import { brandProfiles } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import type { BrandProfileInput } from "@/lib/validation/brand-profile";

export type BrandProfile = typeof brandProfiles.$inferSelect;

export async function listBrandProfiles(ownerId: string): Promise<BrandProfile[]> {
  return db
    .select()
    .from(brandProfiles)
    .where(eq(brandProfiles.ownerId, ownerId))
    .orderBy(desc(brandProfiles.createdAt));
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
  return row ?? null;
}

export async function createBrandProfile(
  ownerId: string,
  input: BrandProfileInput
): Promise<BrandProfile> {
  const [row] = await db
    .insert(brandProfiles)
    .values({
      ownerId,
      name: input.name,
      accentColor: input.accentColor,
      logoUrl: input.logoUrl ?? null,
    })
    .returning();
  return row;
}

export async function updateBrandProfile(
  id: string,
  ownerId: string,
  input: BrandProfileInput
): Promise<BrandProfile | null> {
  const [row] = await db
    .update(brandProfiles)
    .set({
      name: input.name,
      accentColor: input.accentColor,
      logoUrl: input.logoUrl ?? null,
    })
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
