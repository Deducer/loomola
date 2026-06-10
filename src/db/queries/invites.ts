import { db } from "@/db";
import { invites } from "@/db/schema";
import { desc, eq } from "drizzle-orm";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function createInvite(params: {
  createdBy: string;
  email: string;
  tokenHash: string;
}) {
  const [row] = await db
    .insert(invites)
    .values({
      createdBy: params.createdBy,
      email: params.email,
      tokenHash: params.tokenHash,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    })
    .returning();
  return row;
}

export async function getInviteByTokenHash(tokenHash: string) {
  const rows = await db
    .select()
    .from(invites)
    .where(eq(invites.tokenHash, tokenHash))
    .limit(1);
  return rows[0] ?? null;
}

export async function markInviteAccepted(id: string) {
  await db
    .update(invites)
    .set({ acceptedAt: new Date() })
    .where(eq(invites.id, id));
}

export async function listInvites() {
  return db.select().from(invites).orderBy(desc(invites.createdAt)).limit(100);
}

export async function deleteInvite(id: string) {
  await db.delete(invites).where(eq(invites.id, id));
}
