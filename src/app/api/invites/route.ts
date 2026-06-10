import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/require-auth";
import { getUserRole } from "@/lib/auth/roles";
import { generateInviteToken } from "@/lib/invites/token";
import { createInvite, listInvites } from "@/db/queries/invites";
import { isEmailConfigured, sendEmail } from "@/lib/mail/mailgun";

function acceptUrlFor(token: string): string {
  return `${process.env.NEXT_PUBLIC_APP_URL}/setup/accept/${token}`;
}

export async function GET(request: Request) {
  const user = await requireAuth(request);
  if ((await getUserRole(user.id)) !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }
  const rows = await listInvites();
  // tokenHash never leaves the server.
  return NextResponse.json({
    invites: rows.map(({ tokenHash: _tokenHash, ...rest }) => rest),
  });
}

export async function POST(request: Request) {
  const user = await requireAuth(request);
  if ((await getUserRole(user.id)) !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }
  const body = await request.json().catch(() => null);
  const parsed = z.object({ email: z.string().email() }).safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Valid email required" }, { status: 400 });
  }

  const { token, tokenHash } = generateInviteToken();
  const invite = await createInvite({
    createdBy: user.id,
    email: parsed.data.email,
    tokenHash,
  });
  const acceptUrl = acceptUrlFor(token);

  let emailed = false;
  if (isEmailConfigured()) {
    try {
      await sendEmail({
        to: parsed.data.email,
        subject: "You're invited to Loomola",
        text: `You've been invited to a Loomola instance. Accept here (link expires in 7 days): ${acceptUrl}`,
        html: `<p>You've been invited to a Loomola instance.</p><p><a href="${acceptUrl}">Accept the invite</a> (expires in 7 days).</p>`,
      });
      emailed = true;
    } catch (e) {
      console.error("[invites] email send failed", e);
    }
  }

  return NextResponse.json({
    id: invite.id,
    email: invite.email,
    expiresAt: invite.expiresAt,
    acceptUrl,
    emailed,
  });
}
