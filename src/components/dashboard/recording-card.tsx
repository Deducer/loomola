"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, CheckCircle2, Eye, Film, Link2, MessageSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { RecordingCardMenu } from "./recording-card-menu";
import type { RecordingWithBrand } from "@/db/queries/recordings";
import type { Folder } from "@/db/queries/folders";

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
  previewUrl,
  folders,
  selectionActive = false,
  selected = false,
  onToggleSelected,
}: {
  rec: RecordingWithBrand;
  thumbnailUrl: string | null;
  previewUrl: string | null;
  folders: Folder[];
  selectionActive?: boolean;
  selected?: boolean;
  onToggleSelected?: (id: string, range?: boolean) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [previewing, setPreviewing] = useState(false);
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

  async function copyShareLink() {
    const url = `${window.location.origin}/v/${rec.slug}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <div
      draggable={!selectionActive}
      onDragStart={(e) => {
        if (selectionActive) {
          e.preventDefault();
          return;
        }
        e.dataTransfer.setData("application/x-recording-id", rec.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      className="group relative"
      data-recording-id={rec.id}
      onMouseEnter={() => setPreviewing(true)}
      onMouseLeave={() => setPreviewing(false)}
      onFocus={() => setPreviewing(true)}
      onBlur={() => setPreviewing(false)}
    >
      <Link
        href={`/recordings/${rec.id}/edit`}
        onClick={(e) => {
          if (selectionActive) {
            e.preventDefault();
            onToggleSelected?.(rec.id, e.shiftKey);
          }
        }}
        className={cn(
          "flex flex-col overflow-hidden rounded-xl border bg-bg-subtle transition-colors hover:border-border-strong",
          selected ? "border-accent ring-2 ring-accent/20" : "border-border"
        )}
      >
        <div className="relative aspect-video w-full overflow-hidden bg-bg-elevated">
          {thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={thumbnailUrl}
              alt=""
              className={cn(
                "h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]",
                previewing && previewUrl ? "opacity-0" : "opacity-100"
              )}
            />
          ) : (
            <div
              className={cn(
                "flex h-full w-full items-center justify-center text-text-subtle",
                previewing && previewUrl ? "opacity-0" : "opacity-100"
              )}
            >
              <Film className="h-8 w-8" />
            </div>
          )}
          {previewing && previewUrl && (
            <video
              src={previewUrl}
              className="absolute inset-0 h-full w-full object-cover"
              autoPlay
              muted
              loop
              playsInline
              preload="metadata"
              aria-hidden="true"
            />
          )}
          <div
            className={cn(
              "absolute left-2 top-2 transition-opacity",
              selectionActive || selected ? "opacity-0" : "opacity-100 group-hover:opacity-0"
            )}
          >
            <Badge variant={statusVariant}>{rec.status}</Badge>
          </div>
          <div className="absolute bottom-2 right-2 rounded-md bg-black/65 px-2 py-1 text-xs font-medium text-white">
            {formatDuration(rec.durationSeconds)}
          </div>
          {accent && (
            <div
              className="absolute inset-x-0 bottom-0 h-[3px]"
              style={{ backgroundColor: accent }}
            />
          )}
        </div>
        <div className="flex flex-col gap-1 p-3">
          <h3 className="truncate text-sm font-medium text-text">
            {displayTitle}
          </h3>
          <div className="flex items-center gap-1.5 text-xs text-text-subtle">
            <span>{formatShortDate(new Date(rec.createdAt))}</span>
            {rec.brand && (
              <>
                <span>·</span>
                <span className="truncate">{rec.brand.name}</span>
              </>
            )}
          </div>
          <div className="mt-2 flex items-center gap-4 text-xs text-text-subtle">
            <span className="inline-flex items-center gap-1">
              <Eye className="h-3.5 w-3.5" />
              {rec.viewCount}
            </span>
            <span className="inline-flex items-center gap-1">
              <MessageSquare className="h-3.5 w-3.5" />
              {rec.commentCount}
            </span>
          </div>
        </div>
      </Link>

      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onToggleSelected?.(rec.id, e.shiftKey);
        }}
        className={cn(
          "absolute left-2 top-2 z-20 flex h-6 w-6 items-center justify-center rounded-md border border-white/80 !bg-white !text-neutral-950 shadow-sm transition-opacity hover:!bg-white/90",
          selectionActive || selected ? "opacity-100" : "opacity-0 group-hover:opacity-100",
          selected && "border-accent !bg-accent !text-accent-fg"
        )}
        aria-label={selected ? "Deselect recording" : "Select recording"}
        aria-pressed={selected}
      >
        {selected ? <Check className="h-4 w-4" /> : null}
      </button>

      <div
        className={cn(
          "absolute right-2 top-2 flex flex-col gap-2 opacity-0 transition-opacity",
          (selectionActive || selected) && "opacity-100",
          !selectionActive && "group-hover:opacity-100"
        )}
      >
        <Tooltip label={copied ? "Copied" : "Copy link"} side="left">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 !bg-white !text-neutral-950 shadow-sm hover:!bg-white/90"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void copyShareLink();
            }}
            aria-label="Copy share link"
          >
            {copied ? (
              <CheckCircle2 className="h-4 w-4 text-accent" />
            ) : (
              <Link2 className="h-4 w-4" />
            )}
          </Button>
        </Tooltip>
        <RecordingCardMenu recordingId={rec.id} folders={folders} />
      </div>
    </div>
  );
}
