import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { requireAuth } from "@/lib/require-auth";
import { db } from "@/db";
import { mediaObjects } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { stackMemberIds } from "@/db/queries/versions";

// Versions in a stack share one password (one unlock covers them all), so
// a change on any version applies to the whole stack.
async function stackIds(ownerId: string, id: string): Promise<string[]> {
  const ids = await stackMemberIds(ownerId, id);
  return ids.length > 0 ? ids : [id];
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth();
  const { id } = await params;
  const body = (await request.json()) as { password?: string };
  const password = (body.password ?? "").trim();
  if (password.length < 4) {
    return NextResponse.json(
      { error: "password_too_short" },
      { status: 400 }
    );
  }
  const hash = await bcrypt.hash(password, 10);
  const result = await db
    .update(mediaObjects)
    .set({ passwordHash: hash })
    .where(and(inArray(mediaObjects.id, await stackIds(user.id, id)), eq(mediaObjects.ownerId, user.id)))
    .returning({ id: mediaObjects.id });
  if (result.length === 0) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth();
  const { id } = await params;
  const result = await db
    .update(mediaObjects)
    .set({ passwordHash: null })
    .where(and(inArray(mediaObjects.id, await stackIds(user.id, id)), eq(mediaObjects.ownerId, user.id)))
    .returning({ id: mediaObjects.id });
  if (result.length === 0) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
