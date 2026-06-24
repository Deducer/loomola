import { NextResponse } from "next/server";
import { getRecordingBySlug } from "@/db/queries/recordings";
import { upsertView } from "@/db/queries/views";
import { hashVisitor } from "@/lib/viewer/visitor-id";
import { getOptionalAuthUser } from "@/lib/require-auth";
import { sendEmail } from "@/lib/mail/mailgun";
import { renderNewViewEmail } from "@/lib/mail/templates/new-view";
import { getSupabaseService } from "@/lib/supabase/service";
import { getUserPreferences } from "@/db/queries/user-preferences";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const rec = await getRecordingBySlug(slug);
  if (!rec) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Owner viewing their own recording: don't track or notify.
  // Anonymous / private-window views still fall through (different
  // visitor hash, no auth user) — accepted trade-off.
  const user = await getOptionalAuthUser(request);
  if (user && user.id === rec.ownerId) {
    return NextResponse.json({ ok: true, skipped: "owner" });
  }

  const visitorHash = hashVisitor(request);
  const ua = (request.headers.get("user-agent") ?? "").slice(0, 120);
  const { inserted } = await upsertView({
    mediaObjectId: rec.id,
    visitorHash,
    userAgentSummary: ua,
  });

  // First-view-per-visitor → notify the owner. Fire-and-forget so the
  // beacon response stays fast; errors are logged but never propagate.
  if (inserted) {
    void (async () => {
      try {
        const preferences = await getUserPreferences(rec.ownerId);
        if (!preferences.notifyFirstView) return;
        const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
        const shareUrl = `${appUrl}/v/${slug}`;
        const editUrl = `${appUrl}/recordings/${rec.id}/edit`;
        const service = getSupabaseService();
        const { data } = await service.auth.admin.getUserById(rec.ownerId);
        const ownerEmail = data?.user?.email;
        if (!ownerEmail) {
          console.warn(
            `[views] owner email missing for recording ${rec.id}; skipping notification`
          );
          return;
        }
        const tpl = renderNewViewEmail({
          recordingTitle: rec.title ?? rec.aiTitle ?? "Untitled recording",
          shareUrl,
          editUrl,
          userAgent: ua,
        });
        await sendEmail({
          to: ownerEmail,
          subject: tpl.subject,
          text: tpl.text,
          html: tpl.html,
        });
      } catch (e) {
        console.error("[views] mailgun notification failed:", e);
      }
    })();
  }

  return NextResponse.json({ ok: true });
}
