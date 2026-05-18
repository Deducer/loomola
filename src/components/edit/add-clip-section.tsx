"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Film, Link2, Loader2, Plus, Search, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";

type ClipCandidate = {
  id: string;
  slug: string;
  title: string;
  durationSeconds: number | null;
  createdAt: string;
  thumbnailUrl: string | null;
  summary: string | null;
  transcriptPreview: string | null;
  creator: string;
};

type CandidateResponse = {
  items: ClipCandidate[];
};

export function AddClipSection({
  recordingId,
  disabledReason,
}: {
  recordingId: string;
  disabledReason: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<ClipCandidate[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(
    () => items.find((item) => item.id === selectedId) ?? null,
    [items, selectedId]
  );

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (query.trim()) params.set("q", query.trim());
        const res = await fetch(
          `/api/recordings/${recordingId}/clips/candidates?${params.toString()}`,
          { signal: controller.signal }
        );
        if (!res.ok) {
          setError(`Search failed (${res.status}).`);
          setItems([]);
          return;
        }
        const data = (await res.json()) as CandidateResponse;
        setItems(data.items);
        setSelectedId((current) =>
          current && data.items.some((item) => item.id === current)
            ? current
            : data.items[0]?.id ?? null
        );
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setError("Search failed.");
          setItems([]);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 180);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [open, query, recordingId]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  async function appendSelected(clipId = selected?.id) {
    if (!clipId) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/recordings/${recordingId}/clips`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clipId }),
      });
      const data = (await res.json().catch(() => null)) as
        | { message?: string }
        | null;
      if (!res.ok) {
        const message = data?.message ?? `Add clip failed (${res.status}).`;
        setError(message);
        toast.error(message);
        return;
      }
      toast.success("Clip append started.");
      setOpen(false);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
        <Film className="h-3.5 w-3.5" />
        Clips
      </h2>
      <div className="rounded-xl border border-border bg-bg-subtle p-3">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-text">Add a clip</div>
            {disabledReason ? (
              <div className="mt-0.5 text-xs text-text-subtle">
                {disabledReason}
              </div>
            ) : null}
          </div>
          <Button
            size="sm"
            onClick={() => setOpen(true)}
            disabled={!!disabledReason}
          >
            <Plus className="h-4 w-4" />
            Add clip
          </Button>
        </div>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 px-4 py-6 backdrop-blur-sm">
          <div
            className="flex max-h-[min(760px,calc(100vh-48px))] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border-strong bg-bg shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-clip-title"
          >
            <div className="flex items-center border-b border-border px-5 py-4">
              <h3
                id="add-clip-title"
                className="text-lg font-semibold tracking-tight text-text"
              >
                Add a clip
              </h3>
              <Button
                variant="ghost"
                size="icon"
                className="ml-auto h-8 w-8"
                onClick={() => setOpen(false)}
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="border-b border-border p-5">
              <div className="relative">
                <Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-subtle" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Paste a Loomola URL or search your videos"
                  className="pl-9"
                  autoFocus
                />
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {loading && items.length === 0 ? (
                <div className="flex h-40 items-center justify-center text-sm text-text-subtle">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Searching
                </div>
              ) : error && items.length === 0 ? (
                <div className="flex h-40 flex-col items-center justify-center text-center text-sm text-text-subtle">
                  <Search className="mb-2 h-5 w-5" />
                  {error}
                </div>
              ) : items.length === 0 ? (
                <div className="flex h-40 flex-col items-center justify-center text-center text-sm text-text-subtle">
                  <Search className="mb-2 h-5 w-5" />
                  No matching clips.
                </div>
              ) : (
                <div className="space-y-2">
                  {items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSelectedId(item.id)}
                      onDoubleClick={() => {
                        setSelectedId(item.id);
                        void appendSelected(item.id);
                      }}
                      className={cn(
                        "grid w-full grid-cols-[128px_minmax(0,1fr)] gap-3 rounded-lg border p-2 text-left transition-colors hover:border-border-strong hover:bg-bg-subtle",
                        selectedId === item.id
                          ? "border-accent bg-accent/10"
                          : "border-transparent"
                      )}
                    >
                      <div className="relative aspect-video overflow-hidden rounded-md bg-bg-elevated">
                        {item.thumbnailUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={item.thumbnailUrl}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-text-subtle">
                            <Film className="h-6 w-6" />
                          </div>
                        )}
                        <div className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-medium text-white">
                          {formatDuration(item.durationSeconds)}
                        </div>
                      </div>
                      <div className="min-w-0 py-0.5">
                        <div className="flex min-w-0 items-start gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-semibold text-text">
                              {item.title}
                            </div>
                            <div className="mt-0.5 truncate text-xs text-text-subtle">
                              {item.creator} - {relativeAge(item.createdAt)}
                            </div>
                          </div>
                          {selectedId === item.id ? (
                            <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                          ) : null}
                        </div>
                        <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-text-muted">
                          {item.transcriptPreview ?? item.summary ?? "No transcript preview yet."}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 border-t border-border px-5 py-4">
              {loading && items.length > 0 ? (
                <span className="inline-flex items-center text-xs text-text-subtle">
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Updating
                </span>
              ) : error ? (
                <span className="min-w-0 flex-1 truncate text-xs text-destructive">
                  {error}
                </span>
              ) : (
                <span className="min-w-0 flex-1 truncate text-xs text-text-subtle">
                  {selected ? selected.title : "Select a clip"}
                </span>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setOpen(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => void appendSelected()}
                disabled={!selected || submitting}
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                Add selected
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function formatDuration(seconds: number | null): string {
  if (seconds == null || !isFinite(seconds)) return "--";
  const total = Math.max(0, Math.round(seconds));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  if (mins < 60) return `${mins}:${secs.toString().padStart(2, "0")}`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hours}:${remMins.toString().padStart(2, "0")}:${secs
    .toString()
    .padStart(2, "0")}`;
}

function relativeAge(value: string): string {
  const createdAt = new Date(value).getTime();
  const diffMs = createdAt - Date.now();
  const abs = Math.abs(diffMs);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (abs < 60_000) return rtf.format(Math.round(diffMs / 1000), "second");
  if (abs < 3_600_000) return rtf.format(Math.round(diffMs / 60_000), "minute");
  if (abs < 86_400_000) return rtf.format(Math.round(diffMs / 3_600_000), "hour");
  if (abs < 2_592_000_000) {
    return rtf.format(Math.round(diffMs / 86_400_000), "day");
  }
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year:
      new Date(value).getFullYear() === new Date().getFullYear()
        ? undefined
        : "numeric",
  });
}
