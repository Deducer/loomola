import { db } from "@/db";
import { sql } from "drizzle-orm";

/** True once any account exists. Mirrors the raw auth.users access pattern
 * in src/app/api/mcp/tools/owner.ts. */
export async function hasAnyUser(): Promise<boolean> {
  const rows = await db.execute(sql`SELECT 1 FROM auth.users LIMIT 1`);
  return rows.length > 0;
}
