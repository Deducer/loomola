function formatTs(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function renderNewCommentEmail(params: {
  recordingTitle: string;
  commenterName: string;
  commenterEmail: string;
  body: string;
  timestampSec: number;
  shareUrl: string;
}): { subject: string; text: string; html: string } {
  const ts = formatTs(params.timestampSec);
  const deepLink = `${params.shareUrl}#t=${Math.max(0, Math.floor(params.timestampSec))}`;

  const rawSubject = `New comment from ${params.commenterName} on ${params.recordingTitle}`;
  const subject =
    rawSubject.length <= 100 ? rawSubject : rawSubject.slice(0, 97) + "...";

  const text = [
    `${params.commenterName} (${params.commenterEmail}) commented at ${ts}:`,
    "",
    params.body,
    "",
    `Reply or open in app: ${deepLink}`,
  ].join("\n");

  const html = `
<div style="font-family: system-ui, sans-serif; max-width: 520px; line-height: 1.5;">
  <p style="margin: 0 0 12px;">
    <strong>${escapeHtml(params.commenterName)}</strong>
    <span style="opacity: 0.7;">&lt;${escapeHtml(params.commenterEmail)}&gt;</span>
    commented at <code style="background: #f3f4f6; padding: 2px 4px; border-radius: 4px;">${ts}</code>:
  </p>
  <blockquote style="margin: 0 0 16px; padding: 12px 16px; border-left: 3px solid #e5e7eb; background: #f9fafb; white-space: pre-wrap;">${escapeHtml(params.body)}</blockquote>
  <p style="margin: 0;">
    <a href="${deepLink}" style="color: #4f46e5;">Open in app</a>
  </p>
</div>`.trim();

  return { subject, text, html };
}
