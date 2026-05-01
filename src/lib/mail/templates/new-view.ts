function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Best-effort one-line summary of a User-Agent string. The full UA is
 * unwieldy and varies wildly; we just pull a browser + OS hint so the
 * email reads "Chrome on macOS" instead of a 200-character noise blob.
 * Falls back to "Unknown browser" when parsing finds nothing useful.
 */
function summarizeUa(ua: string): string {
  const lower = ua.toLowerCase();
  let browser = "Unknown browser";
  if (lower.includes("edg/")) browser = "Edge";
  else if (lower.includes("opr/") || lower.includes("opera")) browser = "Opera";
  else if (lower.includes("chrome/")) browser = "Chrome";
  else if (lower.includes("firefox/")) browser = "Firefox";
  else if (lower.includes("safari/") && !lower.includes("chrome/")) browser = "Safari";

  let os = "";
  if (lower.includes("iphone") || lower.includes("ipad")) os = "iOS";
  else if (lower.includes("android")) os = "Android";
  else if (lower.includes("mac os") || lower.includes("macintosh")) os = "macOS";
  else if (lower.includes("windows")) os = "Windows";
  else if (lower.includes("linux")) os = "Linux";

  return os ? `${browser} on ${os}` : browser;
}

export function renderNewViewEmail(params: {
  recordingTitle: string;
  shareUrl: string;
  editUrl: string;
  userAgent: string;
}): { subject: string; text: string; html: string } {
  const ua = summarizeUa(params.userAgent);
  const rawSubject = `Someone watched "${params.recordingTitle}"`;
  const subject =
    rawSubject.length <= 100 ? rawSubject : rawSubject.slice(0, 97) + "...";

  const text = [
    `A new viewer just opened "${params.recordingTitle}".`,
    "",
    `Browser: ${ua}`,
    "",
    `Share link: ${params.shareUrl}`,
    `Analytics: ${params.editUrl}`,
    "",
    "(Subsequent views by this visitor won't trigger another email.)",
  ].join("\n");

  const html = `
<div style="font-family: system-ui, sans-serif; max-width: 520px; line-height: 1.5;">
  <p style="margin: 0 0 12px;">
    A new viewer just opened
    <strong>${escapeHtml(params.recordingTitle)}</strong>.
  </p>
  <p style="margin: 0 0 12px; color: #4b5563;">
    Browser: <code style="background: #f3f4f6; padding: 2px 6px; border-radius: 4px;">${escapeHtml(ua)}</code>
  </p>
  <p style="margin: 0 0 6px;">
    <a href="${params.shareUrl}" style="color: #4f46e5;">Open share page</a>
    &nbsp;·&nbsp;
    <a href="${params.editUrl}" style="color: #4f46e5;">View analytics</a>
  </p>
  <p style="margin: 18px 0 0; font-size: 12px; color: #9ca3af;">
    Subsequent views by this visitor won't trigger another email.
  </p>
</div>`.trim();

  return { subject, text, html };
}
