// POST /api/contact
//
// Public landing-page contact form. Sends an email via Mailgun to the
// owner's inbox (configured via CONTACT_INBOX env var) with the
// visitor's question or feature request. Spam protection: a hidden
// honeypot field plus a sliding-window rate limit keyed on the visitor
// IP hash (3 submissions per hour).
//
// This endpoint is allowlisted in src/lib/supabase/middleware.ts so
// unauthenticated visitors can hit it.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isEmailConfigured, sendEmail } from "@/lib/mail/mailgun";
import { checkRateLimit } from "@/lib/rate-limit/check";
import { hashVisitor } from "@/lib/viewer/visitor-id";

const CONTACT_INBOX = process.env.CONTACT_INBOX;

const TOPIC_LABELS = {
  setup: "Self-hosted setup help",
  "granola-import": "Importing from Granola",
  "loom-import": "Importing from Loom",
  onboarding: "New to self-hosting / open source",
  feedback: "Feedback or feature request",
  other: "Something else",
} as const;

const schema = z.object({
  email: z.string().email().max(200),
  topic: z.enum([
    "setup",
    "granola-import",
    "loom-import",
    "onboarding",
    "feedback",
    "other",
  ]),
  message: z.string().trim().min(2).max(4000),
  // Honeypot — visitors don't see it; bots fill it.
  honeypot: z.string().optional(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!CONTACT_INBOX) {
    console.error("[contact] CONTACT_INBOX env var is not set");
    return NextResponse.json(
      { error: "Contact form is misconfigured. Please try again later." },
      { status: 503 }
    );
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON" },
      { status: 400 }
    );
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { email, topic, message, honeypot } = parsed.data;

  // Honeypot tripped — pretend success so bots don't iterate.
  if (honeypot && honeypot.trim().length > 0) {
    return NextResponse.json({ ok: true });
  }

  // Rate limit per visitor IP. 3 per hour is generous for a real human
  // and tight enough to make scripted abuse uneconomical.
  const ipHash = hashVisitor(req);
  const limit = await checkRateLimit({
    scope: "contact-form:visitor",
    key: ipHash,
    max: 3,
    windowSec: 3600,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Try again later." },
      { status: 429 }
    );
  }

  if (!isEmailConfigured()) {
    return NextResponse.json(
      { error: "This instance has no email configured, so the contact form is disabled." },
      { status: 503 }
    );
  }

  const topicLabel = TOPIC_LABELS[topic];
  const subject = `[Loomola] ${topicLabel}`;
  const text = [
    `From: ${email}`,
    `Topic: ${topicLabel}`,
    "",
    message,
  ].join("\n");
  const html = `
    <p style="margin:0 0 8px"><strong>From:</strong> <a href="mailto:${email}">${email}</a></p>
    <p style="margin:0 0 8px"><strong>Topic:</strong> ${topicLabel}</p>
    <pre style="white-space:pre-wrap;font-family:system-ui,sans-serif;margin:0">${escapeHtml(message)}</pre>
  `;

  try {
    await sendEmail({ to: CONTACT_INBOX, subject, text, html });
  } catch (e) {
    console.error("[contact] Mailgun send failed", e);
    return NextResponse.json(
      { error: "Send failed; please try again later." },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
