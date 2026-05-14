import { db } from "@/db";
import { sql } from "drizzle-orm";

let cachedOwnerId: string | null = null;

export async function getMcpOwnerId(): Promise<string> {
  if (process.env.MCP_OWNER_ID) return process.env.MCP_OWNER_ID;
  if (cachedOwnerId) return cachedOwnerId;

  const email = process.env.MCP_OWNER_EMAIL ?? process.env.TEST_CREATOR_EMAIL;
  const rows = email
    ? await db.execute<{ id: string }>(
        sql`SELECT id::text AS id FROM auth.users WHERE email = ${email} LIMIT 1`
      )
    : await db.execute<{ id: string }>(
        sql`SELECT id::text AS id FROM auth.users ORDER BY created_at ASC LIMIT 1`
      );

  const ownerId = rows[0]?.id;
  if (!ownerId) {
    throw new Error("mcp_owner_not_found");
  }

  cachedOwnerId = ownerId;
  return ownerId;
}

export function clearMcpOwnerCacheForTests(): void {
  cachedOwnerId = null;
}
