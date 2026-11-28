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
  /** Range comment end ("on 0:12–0:18"). */
  endSec?: number | null;
  hasDrawing?: boolean;
  isReply?: boolean;
  shareUrl: string;
}): { subject: string; text: string; html: string } {
  const ts =
    params.endSec != null
      ? `${formatTs(params.timestampSec)}–${formatTs(params.endSec)}`
      : formatTs(params.timestampSec);
  const verb = params.isReply ? "replied" : "commented";
  const where = params.endSec != null ? "on" : "at";
  const drawing = params.hasDrawing ? " with a drawing" : "";
  const deepLink = `${params.shareUrl}#t=${Math.max(0, Math.floor(params.timestampSec))}`;

  const rawSubject = params.isReply
    ? `New reply from ${params.commenterName} on ${params.recordingTitle}`
    : `New comment from ${params.commenterName} on ${params.recordingTitle}`;
  // Names are visitor-typed; keep the subject one line.
  const oneLine = rawSubject.replace(/[\r\n]+/g, " ");
  const subject =
    oneLine.length <= 100 ? oneLine : oneLine.slice(0, 97) + "...";

  const text = [
    `${params.commenterName} (${params.commenterEmail}) ${verb} ${where} ${ts}${drawing}:`,
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
    ${verb} ${where} <code style="background: #f3f4f6; padding: 2px 4px; border-radius: 4px;">${ts}</code>${drawing}:
  </p>
  <blockquote style="margin: 0 0 16px; padding: 12px 16px; border-left: 3px solid #e5e7eb; background: #f9fafb; white-space: pre-wrap;">${escapeHtml(params.body)}</blockquote>
  <p style="margin: 0;">
    <a href="${deepLink}" style="color: #4f46e5;">Open in app</a>
  </p>
</div>`.trim();

  return { subject, text, html };
}
