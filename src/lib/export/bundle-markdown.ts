import type { ExportBundleMediaData } from "@/db/queries/export-bundle";

export function buildBundleMarkdown(
  item: ExportBundleMediaData,
  appBaseUrl: string
): string {
  const title = bundleTitle(item);
  const appUrl =
    item.media.type === "audio"
      ? `${appBaseUrl}/notes/${item.media.slug}`
      : `${appBaseUrl}/v/${item.media.slug}`;
  const lines = [
    "---",
    `meeting_id: ${yamlString(item.media.id)}`,
    `type: ${yamlString(item.media.type)}`,
    `slug: ${yamlString(item.media.slug)}`,
    `title: ${yamlString(title)}`,
    `created_at: ${yamlString(item.media.createdAt.toISOString())}`,
    `status: ${yamlString(item.media.status)}`,
    `duration_seconds: ${item.media.durationSeconds ?? "null"}`,
    `project: ${yamlNullable(item.brandProfile?.name ?? null)}`,
    `app_url: ${yamlString(appUrl)}`,
    "---",
    "",
    `# ${title}`,
    "",
    `- Type: ${item.media.type === "audio" ? "Audio note" : "Video recording"}`,
    `- Date: ${formatDate(item.media.createdAt)}`,
    `- Duration: ${formatDuration(item.media.durationSeconds)}`,
    `- Status: ${item.media.status}`,
    `- App: ${appUrl}`,
  ];

  if (item.brandProfile) lines.push(`- Project: ${item.brandProfile.name}`);
  if (item.media.meetingDetectedApp) {
    lines.push(`- Source: ${item.media.meetingDetectedApp}`);
  }
  if (item.media.sourceContextHint) {
    lines.push(`- Context: ${item.media.sourceContextHint}`);
  }

  if (item.media.type === "audio") {
    lines.push("", "## Notes", "", item.note?.body.trim() || "_No typed notes._");
  }

  lines.push("", "## Summary", "", item.aiOutput?.summary?.trim() || "_No summary yet._");
  lines.push("", "## Action Items", "", formatActionItems(item.aiOutput?.actionItems));
  lines.push("", "## Chapters", "", formatChapters(item.aiOutput?.chapters));
  lines.push("", "## Transcript", "", item.transcript?.fullText.trim() || "_No transcript yet._");

  return `${lines.join("\n")}\n`;
}

export function bundleEntryPath(item: ExportBundleMediaData): string {
  const date = item.media.createdAt.toISOString().slice(0, 10);
  const title = slugPart(bundleTitle(item));
  return `${item.media.type}/${date}-${title || item.media.slug}.md`;
}

function bundleTitle(item: ExportBundleMediaData): string {
  return (
    item.media.title ??
    item.aiOutput?.titleSuggested ??
    (item.media.type === "audio" ? "Untitled audio note" : "Untitled recording")
  );
}

function formatActionItems(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) return "_No action items._";
  return value
    .map((item) => {
      if (typeof item === "string") return `- [ ] ${item}`;
      if (!item || typeof item !== "object") return null;
      const text = "text" in item ? item.text : null;
      const timestamp = "timestamp_sec" in item ? item.timestamp_sec : null;
      if (typeof text !== "string" || !text.trim()) return null;
      return `- [ ] ${text}${typeof timestamp === "number" ? ` (${formatTimestamp(timestamp)})` : ""}`;
    })
    .filter(Boolean)
    .join("\n") || "_No action items._";
}

function formatChapters(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) return "_No chapters yet._";
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const title = "title" in item ? item.title : null;
      const start = "start_sec" in item ? item.start_sec : null;
      if (typeof title !== "string" || !title.trim()) return null;
      return `- ${typeof start === "number" ? `[${formatTimestamp(start)}] ` : ""}${title}`;
    })
    .filter(Boolean)
    .join("\n") || "_No chapters yet._";
}

function slugPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function yamlNullable(value: string | null): string {
  return value ? yamlString(value) : "null";
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(value);
}

function formatDuration(value: string | null): string {
  const seconds = Math.round(Number(value ?? 0));
  if (!Number.isFinite(seconds) || seconds <= 0) return "unknown";
  return formatTimestamp(seconds);
}

function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
    : `${minutes}:${String(secs).padStart(2, "0")}`;
}
