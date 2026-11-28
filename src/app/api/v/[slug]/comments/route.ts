import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getRecordingRefBySlug } from "@/db/queries/recordings";
import {
  createComment,
  getTopLevelComment,
  listCommentsForRecording,
} from "@/db/queries/comments";
import { cookieName, verifyUnlockToken } from "@/lib/viewer/unlock-cookie";
import { hashVisitor } from "@/lib/viewer/visitor-id";
import { checkAndBump } from "@/lib/comments/rate-limit";
import { sendEmail } from "@/lib/mail/mailgun";
import { renderNewCommentEmail } from "@/lib/mail/templates/new-comment";
import { getSupabaseService } from "@/lib/supabase/service";
import { getUserPreferences } from "@/db/queries/user-preferences";
import { getOptionalAuthUser } from "@/lib/require-auth";
import { parseCommentInput } from "@/lib/review/comment-input";
import { buildThreads, toReviewComment } from "@/lib/review/comments";
import { isEmptyAnnotation } from "@/lib/review/annotation";

type Ref = NonNullable<Awaited<ReturnType<typeof getRecordingRefBySlug>>>;

async function canView(slug: string, rec: Ref): Promise<boolean> {
  if (!rec.passwordHash) return true;
  const user = await getOptionalAuthUser();
  if (user && user.id === rec.ownerId) return true;
  const jar = await cookies();
  const token = jar.get(cookieName(slug))?.value ?? "";
  return verifyUnlockToken({ slug, passwordHash: rec.passwordHash, token });
}

/** Public list: top-level comments by time, each with its replies nested.
 *  Commenter emails are never returned. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const rec = await getRecordingRefBySlug(slug);
  if (!rec) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!(await canView(slug, rec))) {
    return NextResponse.json({ error: "locked" }, { status: 403 });
  }
  const rows = await listCommentsForRecording(rec.id);
  const threads = buildThreads(rows.map(toReviewComment));
  return NextResponse.json({ comments: threads });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const parsed = parseCommentInput(await request.json().catch(() => ({})));
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const input = parsed.value;

  const rec = await getRecordingRefBySlug(slug);
  if (!rec) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Password-locked recordings require a valid unlock cookie (or the
  // owner's session) to comment.
  if (!(await canView(slug, rec))) {
    return NextResponse.json({ error: "locked" }, { status: 403 });
  }

  // A reply must hang off a top-level comment on this same recording, and
  // shows at its parent's time.
  let timestampSec = input.timestampSec;
  if (input.parentId) {
    const parent = await getTopLevelComment(rec.id, input.parentId);
    if (!parent) {
      return NextResponse.json({ error: "bad_parent" }, { status: 400 });
    }
    timestampSec = Number(parent.timestampSec);
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
    name: input.name,
    email: input.email,
    timestampSec,
    body: input.body,
    endSec: input.endSec,
    annotation: input.annotation,
    parentId: input.parentId,
  });

  // Same shape as the share page's server-rendered rows, so the client can
  // add it to local state without waiting for router.refresh.
  const created = toReviewComment(row);

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
        commenterName: input.name,
        commenterEmail: input.email,
        body: input.body,
        timestampSec,
        endSec: input.endSec,
        hasDrawing: !isEmptyAnnotation(input.annotation),
        isReply: !!input.parentId,
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
