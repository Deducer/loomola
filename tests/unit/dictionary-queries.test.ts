import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { dictionaryTerms } from "@/db/schema";
import {
  createDictionaryTerm,
  deleteDictionaryTerm,
  getCanonicalTerms,
  listDictionaryTerms,
  updateDictionaryTerm,
} from "@/db/queries/dictionary-terms";

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;
const OWNER_A = randomUUID();
const OWNER_B = randomUUID();

afterEach(async () => {
  if (!process.env.DATABASE_URL) return;
  await db.delete(dictionaryTerms).where(eq(dictionaryTerms.ownerId, OWNER_A));
  await db.delete(dictionaryTerms).where(eq(dictionaryTerms.ownerId, OWNER_B));
});

describeDb("dictionary_terms queries", () => {
  it("createDictionaryTerm rejects duplicate owner and term pairs", async () => {
    await createDictionaryTerm(OWNER_A, "Aman");
    await expect(createDictionaryTerm(OWNER_A, "Aman")).rejects.toThrow();
  });

  it("listDictionaryTerms returns only owner's rows", async () => {
    await createDictionaryTerm(OWNER_A, "Aman");
    await createDictionaryTerm(OWNER_A, "Sara");
    await createDictionaryTerm(OWNER_B, "Bob");
    const list = await listDictionaryTerms(OWNER_A);
    expect(list.length).toBe(2);
  });

  it("variantOf links to a canonical term", async () => {
    const canonical = await createDictionaryTerm(OWNER_A, "Aman");
    const variant = await createDictionaryTerm(
      OWNER_A,
      "Amaan",
      canonical.id
    );
    expect(variant.variantOf).toBe(canonical.id);
  });

  it("rejects variantOf from a different owner", async () => {
    const canonical = await createDictionaryTerm(OWNER_B, "Bob");
    await expect(
      createDictionaryTerm(OWNER_A, "Bobb", canonical.id)
    ).rejects.toThrow("variant_not_found");
  });

  it("getCanonicalTerms returns canonicals only", async () => {
    const canonical = await createDictionaryTerm(OWNER_A, "Aman");
    await createDictionaryTerm(OWNER_A, "Amaan", canonical.id);
    await createDictionaryTerm(OWNER_A, "Sara");
    const list = await getCanonicalTerms(OWNER_A);
    expect(list.map((term) => term.term)).toEqual(["Aman", "Sara"]);
  });

  it("deleteDictionaryTerm removes the row", async () => {
    const term = await createDictionaryTerm(OWNER_A, "Aman");
    const removed = await deleteDictionaryTerm(term.id, OWNER_A);
    expect(removed).toBe(true);
  });

  it("updateDictionaryTerm changes term and variantOf", async () => {
    const canonical = await createDictionaryTerm(OWNER_A, "Aman");
    const variant = await createDictionaryTerm(OWNER_A, "Amaan");
    const updated = await updateDictionaryTerm(variant.id, OWNER_A, {
      variantOf: canonical.id,
    });
    expect(updated?.variantOf).toBe(canonical.id);
  });
});
