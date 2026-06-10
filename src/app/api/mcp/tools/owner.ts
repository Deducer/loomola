import { db } from "@/db";
import { sql } from "drizzle-orm";

let cachedOwnerId: string | null = null;

export async function getMcpOwnerId(): Promise<string> {
  if (process.env.MCP_OWNER_ID) return process.env.MCP_OWNER_ID;
  if (cachedOwnerId) return cachedOwnerId;

  const email = process.env.MCP_OWNER_EMAIL ?? process.env.TEST_CREATOR_EMAIL;
  if (email) {
    const rows = await db.execute<{ id: string }>(
      sql`SELECT id::text AS id FROM auth.users WHERE email = ${email} LIMIT 1`
    );
    const ownerId = rows[0]?.id;
    if (!ownerId) {
      throw new Error("mcp_owner_not_found");
    }
    cachedOwnerId = ownerId;
    return ownerId;
  }

  // No env config: safe only when exactly one user exists.
  const rows = await db.execute<{ id: string }>(
    sql`SELECT id::text AS id FROM auth.users ORDER BY created_at ASC LIMIT 2`
  );
  if (rows.length === 0) throw new Error("No users exist yet");
  if (rows.length > 1) {
    throw new Error(
      "Multiple users exist on this instance; set MCP_OWNER_ID or MCP_OWNER_EMAIL to pin the MCP server to one account"
    );
  }

  cachedOwnerId = rows[0].id;
  return cachedOwnerId;
}

export function clearMcpOwnerCacheForTests(): void {
  cachedOwnerId = null;
}
