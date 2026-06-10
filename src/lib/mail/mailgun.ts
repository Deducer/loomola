function envOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

export function isEmailConfigured(): boolean {
  return Boolean(
    process.env.MAILGUN_API_KEY &&
      process.env.MAILGUN_DOMAIN &&
      process.env.MAIL_FROM_ADDRESS
  );
}

/**
 * Sends a transactional email via Mailgun's HTTP API. No SDK; just a fetch
 * against `POST https://api.mailgun.net/v3/<domain>/messages` with basic
 * auth `api:<api_key>` and a form-encoded body.
 *
 * No-ops silently when Mailgun env vars are not configured (see isEmailConfigured).
 * Throws on non-2xx so callers can choose to fire-and-forget (wrap the call
 * in try/catch and log) or await (for tests and one-off manual sends).
 */
export async function sendEmail({
  to,
  subject,
  text,
  html,
}: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<void> {
  if (!isEmailConfigured()) {
    console.log(`[mail] email not configured; skipping send: "${subject}"`);
    return;
  }
  const apiKey = envOrThrow("MAILGUN_API_KEY");
  const domain = envOrThrow("MAILGUN_DOMAIN");
  const from = envOrThrow("MAIL_FROM_ADDRESS");

  const form = new URLSearchParams();
  form.set("from", from);
  form.set("to", to);
  form.set("subject", subject);
  form.set("text", text);
  form.set("html", html);

  const auth = Buffer.from(`api:${apiKey}`).toString("base64");
  const res = await fetch(`https://api.mailgun.net/v3/${domain}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });

  if (!res.ok) {
    const details = await res.text().catch(() => "");
    throw new Error(`Mailgun send failed: ${res.status} ${details.slice(0, 200)}`);
  }
}
