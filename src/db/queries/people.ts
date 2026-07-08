import { db } from "@/db";
import { mediaObjects, people } from "@/db/schema";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";

export type Person = typeof people.$inferSelect;

/**
 * Display names of a recording's attendees (media_objects.attendees is a
 * jsonb array of person UUIDs). Used to make transcription and AI runs
 * name-aware: attendee names go to Deepgram as keyword boosts and into
 * the enhancement prompts so "Bosco" comes out as "Bhaskar" without the
 * user hand-curating dictionary variants.
 */
export async function listAttendeeNamesForMedia(
  mediaObjectId: string
): Promise<string[]> {
  const [media] = await db
    .select({ ownerId: mediaObjects.ownerId, attendees: mediaObjects.attendees })
    .from(mediaObjects)
    .where(eq(mediaObjects.id, mediaObjectId))
    .limit(1);
  if (!media) return [];
  const ids = Array.isArray(media.attendees)
    ? media.attendees.filter((v): v is string => typeof v === "string")
    : [];
  if (ids.length === 0) return [];
  const rows = await db
    .select({ displayName: people.displayName })
    .from(people)
    .where(and(eq(people.ownerId, media.ownerId), inArray(people.id, ids)));
  return rows.map((row) => row.displayName).filter((name) => name.trim().length > 0);
}

/**
 * Find a person row that matches the given email — checking both
 * the canonical `email` column and the `email_aliases` jsonb array.
 * Returns the first hit, or null. Used by the Granola import endpoint
 * so a re-import of an attendee under a different email merges into
 * an existing manually-created person rather than creating a dupe.
 */
export async function findPersonByAnyEmail(
  ownerId: string,
  email: string
): Promise<Person | null> {
  const lower = email.trim().toLowerCase();
  if (!lower) return null;
  const [row] = await db
    .select()
    .from(people)
    .where(
      and(
        eq(people.ownerId, ownerId),
        or(
          sql`lower(${people.email}) = ${lower}`,
          // jsonb @> '["lower-email"]' — needs the literal array. Build
          // via JSON.stringify for safety. The GIN index in migration
          // 0024 makes this O(log n).
          sql`${people.emailAliases} @> ${JSON.stringify([lower])}::jsonb`
        )
      )
    )
    .limit(1);
  return row ?? null;
}

/** Case-insensitive exact display-name match — the fallback identity for
 *  calendar attendees whose invite carries no email. */
export async function findPersonByDisplayName(
  ownerId: string,
  displayName: string
): Promise<Person | null> {
  const lower = displayName.trim().toLowerCase();
  if (!lower) return null;
  const [row] = await db
    .select()
    .from(people)
    .where(
      and(
        eq(people.ownerId, ownerId),
        sql`lower(${people.displayName}) = ${lower}`
      )
    )
    .limit(1);
  return row ?? null;
}

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
