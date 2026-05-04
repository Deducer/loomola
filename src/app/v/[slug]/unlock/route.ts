import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { getRecordingBySlug } from "@/db/queries/recordings";
import { cookieName, signUnlockToken } from "@/lib/viewer/unlock-cookie";
import { hashVisitor } from "@/lib/viewer/visitor-id";
import { checkRateLimit } from "@/lib/rate-limit/check";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    password?: string;
  };
  const password = body.password ?? "";

  // Brute-force defense: 5 attempts per visitor hash per 5 minutes. The
  // limit applies to *all* attempts (including 404 / missing-password) so
  // a flood doesn't probe slug existence either.
  const visitorHash = hashVisitor(request);
  const rate = await checkRateLimit({
    scope: "unlock:visitor",
    key: visitorHash,
    max: 5,
    windowSec: 300,
  });
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "rate_limited", retryAfterSec: rate.retryAfterSec ?? 60 },
      {
        status: 429,
        headers: {
          "Retry-After": String(rate.retryAfterSec ?? 60),
        },
      }
    );
  }

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
