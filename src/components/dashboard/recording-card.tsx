import Link from "next/link";
import type { RecordingWithBrand } from "@/db/queries/recordings";

function formatDuration(seconds: string | number | null): string {
  if (seconds === null) return "—";
  const n = typeof seconds === "string" ? parseFloat(seconds) : seconds;
  if (!isFinite(n)) return "—";
  const m = Math.floor(n / 60);
  const s = Math.floor(n % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatRelative(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}

const STATUS_STYLES: Record<string, string> = {
  uploading: "bg-blue-500/20 text-blue-200",
  transcribing: "bg-yellow-500/20 text-yellow-200",
  processing: "bg-yellow-500/20 text-yellow-200",
  ready: "bg-emerald-500/20 text-emerald-200",
  failed: "bg-red-500/20 text-red-200",
};

export function RecordingCard({
  rec,
  thumbnailUrl,
}: {
  rec: RecordingWithBrand;
  thumbnailUrl: string | null;
}) {
  const displayTitle = rec.title || rec.aiTitle || "Untitled recording";
  return (
    <Link
      href={`/v/${rec.slug}`}
      className="flex flex-col gap-3 rounded-lg border border-white/10 p-4 hover:border-white/30"
      style={
        rec.brand
          ? { borderLeftColor: rec.brand.accentColor, borderLeftWidth: 4 }
          : undefined
      }
    >
      {thumbnailUrl ? (
        <img
          src={thumbnailUrl}
          alt=""
          className="aspect-video w-full rounded object-cover"
        />
      ) : (
        <div className="flex aspect-video w-full items-center justify-center rounded bg-white/5 text-xs opacity-40">
          {rec.status === "ready" ? "No thumbnail" : "Generating…"}
        </div>
      )}
      <div>
        <div className="flex items-center justify-between gap-2">
          <h3 className="truncate text-sm font-medium">{displayTitle}</h3>
          <span
            className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${
              STATUS_STYLES[rec.status] ?? "bg-white/10"
            }`}
          >
            {rec.status}
          </span>
        </div>
        <div className="mt-1 flex items-center gap-2 text-xs opacity-60">
          <span>{formatDuration(rec.durationSeconds)}</span>
          <span>·</span>
          <span>{formatRelative(new Date(rec.createdAt))}</span>
          {rec.brand && (
            <>
              <span>·</span>
              <span>{rec.brand.name}</span>
            </>
          )}
        </div>
      </div>
    </Link>
  );
}
