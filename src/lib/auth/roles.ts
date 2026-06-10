import { db } from "@/db";
import { userPreferences } from "@/db/schema";
import { eq } from "drizzle-orm";

export type UserRole = "admin" | "member";

export async function getUserRole(ownerId: string): Promise<UserRole> {
  const rows = await db
    .select({ role: userPreferences.role })
    .from(userPreferences)
    .where(eq(userPreferences.ownerId, ownerId))
    .limit(1);
  return rows[0]?.role === "admin" ? "admin" : "member";
}
