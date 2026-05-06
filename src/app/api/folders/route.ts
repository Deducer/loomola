import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/require-auth";
import {
  createFolder,
  getFolderOwned,
  listFoldersForOwner,
} from "@/db/queries/folders";

export async function GET(request: Request) {
  const user = await requireAuth(request);
  const folders = await listFoldersForOwner(user.id);
  return NextResponse.json({
    folders: folders.map((f) => ({
      id: f.id,
      name: f.name,
      parentId: f.parentId,
    })),
  });
}

export async function POST(request: Request) {
  const user = await requireAuth();
  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    parentId?: string | null;
  };
  const name = (body.name ?? "").trim();
  if (!name) {
    return NextResponse.json({ error: "name_required" }, { status: 400 });
  }
  if (name.length > 120) {
    return NextResponse.json({ error: "name_too_long" }, { status: 400 });
  }
  if (body.parentId) {
    const parent = await getFolderOwned(body.parentId, user.id);
    if (!parent) {
      return NextResponse.json({ error: "parent_not_found" }, { status: 404 });
    }
  }
  try {
    const folder = await createFolder({
      ownerId: user.id,
      name,
      parentId: body.parentId ?? null,
    });
    return NextResponse.json({ folder }, { status: 201 });
  } catch (e) {
    if ((e as { code?: string }).code === "23505") {
      return NextResponse.json({ error: "name_in_use" }, { status: 409 });
    }
    throw e;
  }
}
