import { and, eq, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { brandProfiles, mediaObjects } from "@/db/schema";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Agents pass whatever they have: a uuid, a bare slug, or a full share URL
 * (https://host/v/<slug>, /notes/<slug>, /recordings/<id>/edit). Reduce it
 * to the id-or-slug the queries understand.
 */
export function normalizeIdOrSlug(raw: string): string {
  const value = raw.trim();
  const fromPath = value.match(/\/(?:v|notes)\/([A-Za-z0-9_-]+)/);
  if (fromPath) return fromPath[1];
  const fromEdit = value.match(/\/recordings\/([0-9a-f-]{36})/i);
  if (fromEdit) return fromEdit[1];
  return value;
}

export async function findOwnedMedia(ownerId: string, idOrSlug: string) {
  const key = normalizeIdOrSlug(idOrSlug);
  const match = UUID_RE.test(key)
    ? or(eq(mediaObjects.id, key), eq(mediaObjects.slug, key))
    : eq(mediaObjects.slug, key);
  const [row] = await db
    .select()
    .from(mediaObjects)
    .where(and(match, eq(mediaObjects.ownerId, ownerId), isNull(mediaObjects.deletedAt)))
    .limit(1);
  return row ?? null;
}

type BrandRef = { id: string; name: string };

export type BrandPick =
  | { ok: true; brand: BrandRef }
  | { ok: false; reason: "not_found" | "ambiguous"; candidates: BrandRef[] };

/**
 * Match a brand by id, exact name (case-insensitive), or a name fragment
 * that matches exactly one brand. Never guesses between several.
 */
export function pickBrand(brands: BrandRef[], query: string): BrandPick {
  const q = query.trim().toLowerCase();
  const byId = brands.find((b) => b.id.toLowerCase() === q);
  if (byId) return { ok: true, brand: byId };
  const exact = brands.filter((b) => b.name.trim().toLowerCase() === q);
  if (exact.length === 1) return { ok: true, brand: exact[0] };
  if (exact.length > 1) return { ok: false, reason: "ambiguous", candidates: exact };
  const partial = brands.filter((b) => b.name.toLowerCase().includes(q));
  if (partial.length === 1) return { ok: true, brand: partial[0] };
  if (partial.length > 1) return { ok: false, reason: "ambiguous", candidates: partial };
  return { ok: false, reason: "not_found", candidates: brands };
}

export async function listOwnerBrandRefs(ownerId: string): Promise<BrandRef[]> {
  return db
    .select({ id: brandProfiles.id, name: brandProfiles.name })
    .from(brandProfiles)
    .where(eq(brandProfiles.ownerId, ownerId));
}

export async function resolveBrand(ownerId: string, query: string): Promise<BrandPick> {
  return pickBrand(await listOwnerBrandRefs(ownerId), query);
}

export function brandPickError(query: string, pick: Extract<BrandPick, { ok: false }>) {
  return {
    error: pick.reason === "ambiguous" ? "brand_ambiguous" : "brand_not_found",
    message:
      pick.reason === "ambiguous"
        ? `"${query}" matches more than one brand; pass the brand id.`
        : `No brand matches "${query}".`,
    brands: pick.candidates,
  };
}
