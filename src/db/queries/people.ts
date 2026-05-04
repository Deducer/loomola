import { db } from "@/db";
import { people } from "@/db/schema";
import { and, desc, eq, sql } from "drizzle-orm";

export type Person = typeof people.$inferSelect;

export type CreatePersonInput = {
  displayName: string;
  email?: string | null;
  notes?: string | null;
  isSelf?: boolean;
};

export async function createPerson(
  ownerId: string,
  input: CreatePersonInput
): Promise<Person> {
  const [row] = await db
    .insert(people)
    .values({
      ownerId,
      displayName: input.displayName,
      email: input.email ?? null,
      notes: input.notes ?? null,
      isSelf: input.isSelf ?? false,
    })
    .returning();
  return row;
}

export async function listPeople(ownerId: string): Promise<Person[]> {
  return db
    .select()
    .from(people)
    .where(eq(people.ownerId, ownerId))
    .orderBy(desc(people.updatedAt));
}

export async function getPerson(
  id: string,
  ownerId: string
): Promise<Person | null> {
  const [row] = await db
    .select()
    .from(people)
    .where(and(eq(people.id, id), eq(people.ownerId, ownerId)))
    .limit(1);
  return row ?? null;
}

export async function updatePerson(
  id: string,
  ownerId: string,
  patch: Partial<CreatePersonInput>
): Promise<Person | null> {
  const [row] = await db
    .update(people)
    .set({ ...patch, updatedAt: sql`now()` })
    .where(and(eq(people.id, id), eq(people.ownerId, ownerId)))
    .returning();
  return row ?? null;
}

export async function deletePerson(
  id: string,
  ownerId: string
): Promise<boolean> {
  const result = await db
    .delete(people)
    .where(and(eq(people.id, id), eq(people.ownerId, ownerId)))
    .returning({ id: people.id });
  return result.length > 0;
}
