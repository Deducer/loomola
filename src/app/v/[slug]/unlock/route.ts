import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { getRecordingBySlug } from "@/db/queries/recordings";
import { cookieName, signUnlockToken } from "@/lib/viewer/unlock-cookie";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    password?: string;
  };
  const password = body.password ?? "";
  const rec = await getRecordingBySlug(slug);
  if (!rec) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (!rec.passwordHash) {
    return NextResponse.json({ ok: true });
  }
  const ok = await bcrypt.compare(password, rec.passwordHash);
  if (!ok) {
    return NextResponse.json({ error: "bad_password" }, { status: 401 });
  }
  const token = signUnlockToken({ slug, passwordHash: rec.passwordHash });
  const jar = await cookies();
  jar.set(cookieName(slug), token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24,
  });
  return NextResponse.json({ ok: true });
}
