import { db } from "@/db";
import { dictionaryTerms } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";

export type DictionaryTerm = typeof dictionaryTerms.$inferSelect;

async function verifyVariantOwner(
  variantOf: string | null | undefined,
  ownerId: string
) {
  if (!variantOf) return;
  const [canonical] = await db
    .select({ id: dictionaryTerms.id })
    .from(dictionaryTerms)
    .where(
      and(
        eq(dictionaryTerms.id, variantOf),
        eq(dictionaryTerms.ownerId, ownerId)
      )
    )
    .limit(1);
  if (!canonical) throw new Error("variant_not_found");
}

export async function createDictionaryTerm(
  ownerId: string,
  term: string,
  variantOf?: string | null
): Promise<DictionaryTerm> {
  await verifyVariantOwner(variantOf, ownerId);
  const [row] = await db
    .insert(dictionaryTerms)
    .values({ ownerId, term, variantOf: variantOf ?? null })
    .returning();
  return row;
}

export async function listDictionaryTerms(
  ownerId: string
): Promise<DictionaryTerm[]> {
  return db
    .select()
    .from(dictionaryTerms)
    .where(eq(dictionaryTerms.ownerId, ownerId))
    .orderBy(dictionaryTerms.term);
}

export async function getCanonicalTerms(
  ownerId: string
): Promise<DictionaryTerm[]> {
  return db
    .select()
    .from(dictionaryTerms)
    .where(
      and(eq(dictionaryTerms.ownerId, ownerId), isNull(dictionaryTerms.variantOf))
    )
    .orderBy(dictionaryTerms.term);
}

export async function updateDictionaryTerm(
  id: string,
  ownerId: string,
  patch: { term?: string; variantOf?: string | null }
): Promise<DictionaryTerm | null> {
  await verifyVariantOwner(patch.variantOf, ownerId);
  const [row] = await db
    .update(dictionaryTerms)
    .set(patch)
    .where(and(eq(dictionaryTerms.id, id), eq(dictionaryTerms.ownerId, ownerId)))
    .returning();
  return row ?? null;
}

export async function deleteDictionaryTerm(
  id: string,
  ownerId: string
): Promise<boolean> {
  const result = await db
    .delete(dictionaryTerms)
    .where(and(eq(dictionaryTerms.id, id), eq(dictionaryTerms.ownerId, ownerId)))
    .returning({ id: dictionaryTerms.id });
  return result.length > 0;
}
