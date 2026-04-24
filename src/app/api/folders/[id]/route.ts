import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/require-auth";
import {
  deleteFolderOwned,
  getFolderOwned,
  listFoldersForOwner,
  updateFolder,
} from "@/db/queries/folders";
import { wouldCreateCycle } from "@/lib/folders/cycle";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth();
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    parentId?: string | null;
  };

  const current = await getFolderOwned(id, user.id);
  if (!current) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  if (body.parentId !== undefined && body.parentId !== current.parentId) {
    if (body.parentId !== null) {
      const parent = await getFolderOwned(body.parentId, user.id);
      if (!parent) {
        return NextResponse.json(
          { error: "parent_not_found" },
          { status: 404 }
        );
      }
    }
    const all = await listFoldersForOwner(user.id);
    if (wouldCreateCycle(all, id, body.parentId)) {
      return NextResponse.json({ error: "cycle" }, { status: 400 });
    }
  }

  const name = typeof body.name === "string" ? body.name.trim() : undefined;
  if (name !== undefined) {
    if (!name) {
      return NextResponse.json({ error: "name_required" }, { status: 400 });
    }
    if (name.length > 120) {
      return NextResponse.json({ error: "name_too_long" }, { status: 400 });
    }
  }

  try {
    const ok = await updateFolder({
      id,
      ownerId: user.id,
      name,
      parentId: body.parentId,
    });
    if (!ok) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    if ((e as { code?: string }).code === "23505") {
      return NextResponse.json({ error: "name_in_use" }, { status: 409 });
    }
    throw e;
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth();
  const { id } = await params;
  const ok = await deleteFolderOwned({ id, ownerId: user.id });
  if (!ok) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
