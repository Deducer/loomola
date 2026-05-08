import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getRecordingBySlug } from "@/db/queries/recordings";
import { createComment } from "@/db/queries/comments";
import { cookieName, verifyUnlockToken } from "@/lib/viewer/unlock-cookie";
import { hashVisitor } from "@/lib/viewer/visitor-id";
import { checkAndBump } from "@/lib/comments/rate-limit";
import { sendEmail } from "@/lib/mail/mailgun";
import { renderNewCommentEmail } from "@/lib/mail/templates/new-comment";
import { getSupabaseService } from "@/lib/supabase/service";
import { getUserPreferences } from "@/db/queries/user-preferences";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_BODY = 2000;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    email?: string;
    timestampSec?: number;
    body?: string;
  };

  const name = (body.name ?? "").trim();
  const email = (body.email ?? "").trim();
  const content = (body.body ?? "").trim();
  const tsRaw =
    typeof body.timestampSec === "number" && isFinite(body.timestampSec)
      ? body.timestampSec
      : 0;
  const timestampSec = Math.max(0, tsRaw);

  if (!name || !content) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "bad_email" }, { status: 400 });
  }
  if (content.length > MAX_BODY) {
    return NextResponse.json({ error: "body_too_long" }, { status: 400 });
  }

  const rec = await getRecordingBySlug(slug);
  if (!rec) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Password-locked recordings require a valid unlock cookie to comment.
  if (rec.passwordHash) {
    const jar = await cookies();
    const token = jar.get(cookieName(slug))?.value ?? "";
    if (!verifyUnlockToken({ slug, passwordHash: rec.passwordHash, token })) {
      return NextResponse.json({ error: "locked" }, { status: 403 });
    }
  }

  // Rate-limit keyed on the visitor hash (same derivation as view tracking).
  const visitorHash = hashVisitor(request);
  const rate = await checkAndBump(visitorHash);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "rate_limited", retryAfterSec: rate.retryAfterSec ?? 60 },
      { status: 429 }
    );
  }

  const row = await createComment({
    mediaObjectId: rec.id,
    name,
    email,
    timestampSec,
    body: content,
  });

  // Shape for the client's optimistic update — same fields as the
  // share page's server-fetched commentRows so the UI can prepend
  // the new comment immediately without waiting for router.refresh.
  const created = {
    id: row.id,
    commenterName: row.commenterName,
    body: row.body,
    timestampSec: parseFloat(String(row.timestampSec)),
    createdAt: row.createdAt.toISOString(),
  };

  // Fire Mailgun in the background — never awaited, never blocks the
  // response. Errors caught and logged; comment is still persisted.
  void (async () => {
    try {
      const preferences = await getUserPreferences(rec.ownerId);
      if (!preferences.notifyComments) return;
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
      const shareUrl = `${appUrl}/v/${slug}`;
      const service = getSupabaseService();
      const { data } = await service.auth.admin.getUserById(rec.ownerId);
      const ownerEmail = data?.user?.email;
      if (!ownerEmail) {
        console.warn(
          `[comments] owner email missing for recording ${rec.id}; skipping notification`
        );
        return;
      }
      const tpl = renderNewCommentEmail({
        recordingTitle: rec.title ?? rec.aiTitle ?? "Untitled recording",
        commenterName: name,
        commenterEmail: email,
        body: content,
        timestampSec,
        shareUrl,
      });
      await sendEmail({
        to: ownerEmail,
        subject: tpl.subject,
        text: tpl.text,
        html: tpl.html,
      });
    } catch (e) {
      console.error("[comments] mailgun notification failed:", e);
    }
  })();

  return NextResponse.json({ id: row.id, comment: created }, { status: 201 });
}
