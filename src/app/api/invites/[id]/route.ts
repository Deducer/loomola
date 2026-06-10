import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/require-auth";
import { getUserRole } from "@/lib/auth/roles";
import { deleteInvite } from "@/db/queries/invites";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth(request);
  if ((await getUserRole(user.id)) !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }
  const { id } = await params;
  await deleteInvite(id);
  return NextResponse.json({ ok: true });
}
