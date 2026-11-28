import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/require-auth";
import {
  addToStack,
  listStackForOwner,
  removeFromStack,
  setStackOrder,
} from "@/db/queries/versions";
import { findOwnedMedia } from "@/app/api/mcp/tools/lookup";

/** The recording's version stack, ordered (a stack of one when unstacked). */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth(request);
  const { id } = await params;
  const stack = await listStackForOwner(user.id, id);
  if (!stack) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(stack);
}

/** `{ recording }` (id, slug or share URL): add it as the next version. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth(request);
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { recording?: unknown };
  if (typeof body.recording !== "string" || !body.recording.trim()) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const other = await findOwnedMedia(user.id, body.recording);
  if (!other) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const result = await addToStack({ ownerId: user.id, baseId: id, newId: other.id });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.error === "not_found" ? 404 : 409 }
    );
  }
  return NextResponse.json({ ok: true, ...(await listStackForOwner(user.id, id)) });
}

/** `{ order: string[] }`: every live version id, first to last. */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth(request);
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { order?: unknown };
  if (!Array.isArray(body.order) || !body.order.every((x) => typeof x === "string")) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const result = await setStackOrder({
    ownerId: user.id,
    recordingId: id,
    orderedIds: body.order as string[],
  });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.error === "not_found" ? 404 : 409 }
    );
  }
  return NextResponse.json({ ok: true, ...(await listStackForOwner(user.id, id)) });
}

/** Take this recording out of its stack. Nothing is deleted. */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth(request);
  const { id } = await params;
  const result = await removeFromStack({ ownerId: user.id, id });
  if (!result.ok) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true, wasStacked: result.wasStacked });
}
