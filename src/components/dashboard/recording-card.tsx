import Link from "next/link";
import { Film } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { RecordingWithBrand } from "@/db/queries/recordings";

function formatDuration(seconds: string | number | null): string {
  if (seconds === null) return "—";
  const n = typeof seconds === "string" ? parseFloat(seconds) : seconds;
  if (!isFinite(n)) return "—";
  const m = Math.floor(n / 60);
  const s = Math.floor(n % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatShortDate(date: Date): string {
  const now = new Date();
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

type BadgeVariant =
  | "ready"
  | "uploading"
  | "failed"
  | "processing"
  | "transcribing";

export function RecordingCard({
  rec,
  thumbnailUrl,
}: {
  rec: RecordingWithBrand;
  thumbnailUrl: string | null;
}) {
  const displayTitle = rec.title || rec.aiTitle || "Untitled recording";
  const accent = rec.brand?.accentColor;
  const statusVariant: BadgeVariant =
    rec.status === "ready"
      ? "ready"
      : rec.status === "uploading"
        ? "uploading"
        : rec.status === "failed"
          ? "failed"
          : rec.status === "transcribing"
            ? "transcribing"
            : "processing";

  return (
    <Link
      href={`/v/${rec.slug}`}
      className="group flex flex-col overflow-hidden rounded-xl border border-border bg-bg-subtle transition-colors hover:border-border-strong"
    >
      <div className="relative aspect-video w-full overflow-hidden bg-bg-elevated">
        {thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbnailUrl}
            alt=""
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-text-subtle">
            <Film className="h-8 w-8" />
          </div>
        )}
        <div className="absolute right-2 top-2">
          <Badge variant={statusVariant}>{rec.status}</Badge>
        </div>
        {accent && (
          <div
            className="absolute inset-x-0 bottom-0 h-[3px]"
            style={{ backgroundColor: accent }}
          />
        )}
      </div>
      <div className="flex flex-col gap-1 p-3">
        <h3 className="truncate text-sm font-medium text-text">{displayTitle}</h3>
        <div className="flex items-center gap-1.5 text-xs text-text-subtle">
          <span>{formatDuration(rec.durationSeconds)}</span>
          <span>·</span>
          <span>{formatShortDate(new Date(rec.createdAt))}</span>
          {rec.viewCount > 0 && (
            <>
              <span>·</span>
              <span>
                {rec.viewCount} view{rec.viewCount === 1 ? "" : "s"}
              </span>
            </>
          )}
          {rec.brand && (
            <>
              <span>·</span>
              <span className="truncate">{rec.brand.name}</span>
            </>
          )}
        </div>
      </div>
    </Link>
  );
}
