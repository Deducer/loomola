function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export type FailedRecordingEmailItem = {
  title: string;
  kind: "video" | "audio";
  reason: string;
  url: string;
};

/**
 * One email per owner per watchdog tick, listing every recording the
 * watchdog just flipped to failed. Failures used to be silent — the
 * 2026-07-05 232-minute recording sat failed for two days before anyone
 * noticed. Trust requires the system to confess immediately.
 */
export function renderRecordingFailedEmail(params: {
  items: FailedRecordingEmailItem[];
}): { subject: string; text: string; html: string } {
  const count = params.items.length;
  const first = params.items[0];
  const subject =
    count === 1
      ? `Recording needs attention: ${first.title}`.slice(0, 100)
      : `${count} recordings need attention`;

  const textLines = [
    count === 1
      ? "A recording did not finish processing:"
      : `${count} recordings did not finish processing:`,
    "",
    ...params.items.flatMap((item) => [
      `• ${item.title} (${item.kind === "audio" ? "audio note" : "video"})`,
      `  Why: ${item.reason}`,
      `  Open: ${item.url}`,
      "",
    ]),
    "If the recording was made on the desktop app, its audio may be waiting in Settings → Recovery — sign in and it uploads itself.",
  ];

  const itemsHtml = params.items
    .map(
      (item) => `
  <div style="margin: 0 0 16px; padding: 12px 14px; border: 1px solid #e5e5e5; border-radius: 8px;">
    <p style="margin: 0 0 4px; font-weight: 600;">${escapeHtml(item.title)} <span style="font-weight: 400; color: #666;">(${item.kind === "audio" ? "audio note" : "video"})</span></p>
    <p style="margin: 0 0 8px; color: #666;">${escapeHtml(item.reason)}</p>
    <a href="${item.url}" style="color: #4f46e5;">Open in Loomola</a>
  </div>`
    )
    .join("");

  const html = `
<div style="font-family: system-ui, sans-serif; max-width: 520px; line-height: 1.5;">
  <p style="margin: 0 0 12px;">${
    count === 1
      ? "A recording did not finish processing:"
      : `${count} recordings did not finish processing:`
  }</p>
  ${itemsHtml}
  <p style="margin: 12px 0 0; color: #666; font-size: 13px;">
    If the recording was made on the desktop app, its audio may be waiting in
    Settings → Recovery — sign in and it uploads itself.
  </p>
</div>`;

  return { subject, text: textLines.join("\n"), html };
}
