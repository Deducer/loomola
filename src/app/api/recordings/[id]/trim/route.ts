import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/require-auth";
import { db } from "@/db";
import { mediaObjects } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { validateTrim } from "@/lib/viewer/trim-validate";
import { updateTrim, clearTrim } from "@/db/queries/recordings";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth();
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    startSec?: number;
    endSec?: number;
  };
  const startSec = typeof body.startSec === "number" ? body.startSec : NaN;
  const endSec = typeof body.endSec === "number" ? body.endSec : NaN;
  if (!isFinite(startSec) || !isFinite(endSec)) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  const [rec] = await db
    .select({
      id: mediaObjects.id,
      ownerId: mediaObjects.ownerId,
      durationSeconds: mediaObjects.durationSeconds,
    })
    .from(mediaObjects)
    .where(and(eq(mediaObjects.id, id), eq(mediaObjects.ownerId, user.id)))
    .limit(1);

  if (!rec) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const durationSec = parseFloat(String(rec.durationSeconds ?? "0"));
  const check = validateTrim({ startSec, endSec, durationSec });
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: 400 });
  }

  const ok = await updateTrim({ id, ownerId: user.id, startSec, endSec });
  if (!ok) {
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
  const ok = await clearTrim({ id, ownerId: user.id });
  if (!ok) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
