import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { requireAuth } from "@/lib/require-auth";
import { db } from "@/db";
import { mediaObjects } from "@/db/schema";
import { and, eq } from "drizzle-orm";

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
    .where(and(eq(mediaObjects.id, id), eq(mediaObjects.ownerId, user.id)))
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
    .where(and(eq(mediaObjects.id, id), eq(mediaObjects.ownerId, user.id)))
    .returning({ id: mediaObjects.id });
  if (result.length === 0) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
