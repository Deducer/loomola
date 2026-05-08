import { db } from "@/db";
import { userPreferences } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import {
  DEFAULT_USER_PREFERENCES,
  type UserPreferencesPatch,
} from "@/lib/preferences/user-preferences";

export type UserPreferences = typeof userPreferences.$inferSelect;

export async function getUserPreferences(
  ownerId: string
): Promise<UserPreferences> {
  await db
    .insert(userPreferences)
    .values({ ownerId })
    .onConflictDoNothing();

  const [row] = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.ownerId, ownerId))
    .limit(1);

  if (!row) {
    return {
      ownerId,
      ...DEFAULT_USER_PREFERENCES,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  return row;
}

export async function updateUserPreferences(
  ownerId: string,
  patch: UserPreferencesPatch
): Promise<UserPreferences> {
  const set = Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined)
  );

  if (Object.keys(set).length === 0) {
    return getUserPreferences(ownerId);
  }

  const [row] = await db
    .insert(userPreferences)
    .values({ ownerId, ...set })
    .onConflictDoUpdate({
      target: userPreferences.ownerId,
      set: { ...set, updatedAt: sql`now()` },
    })
    .returning();

  return row;
}
