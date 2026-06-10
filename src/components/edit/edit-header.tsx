"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink, Pencil, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { CopyLinkButton } from "@/components/share/copy-link-button";

export function EditHeader({
  recordingId,
  slug,
  title,
  status,
  shareUrl,
  failureReason,
}: {
  recordingId: string;
  slug: string;
  title: string;
  status: "uploading" | "transcribing" | "processing" | "ready" | "failed";
  shareUrl: string;
  failureReason: string | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  async function retry() {
    setRetrying(true);
    try {
      const res = await fetch(`/api/recordings/${recordingId}/retry`, {
        method: "POST",
      });
      const body = (await res.json().catch(() => null)) as {
        message?: string;
      } | null;
      if (!res.ok) {
        toast.error(body?.message ?? `Retry failed (${res.status}).`);
        return;
      }
      toast.success("Retry started — this page will update as it progresses.");
      router.refresh();
    } finally {
      setRetrying(false);
    }
  }

  async function save() {
    if (draft.trim().length === 0 || draft === title) {
      setEditing(false);
      setDraft(title);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/recordings/${recordingId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: draft }),
      });
      if (!res.ok) {
        setError(`Save failed (${res.status}).`);
        return;
      }
      setEditing(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex items-center gap-3">
        {editing ? (
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => {
              if (e.key === "Enter") void save();
              if (e.key === "Escape") {
                setEditing(false);
                setDraft(title);
                setError(null);
              }
            }}
            disabled={busy}
            autoFocus
            className="text-2xl font-semibold tracking-tight"
          />
        ) : (
          <>
            <h1 className="text-2xl font-semibold tracking-tight text-text">
              {title}
            </h1>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Rename"
              onClick={() => {
                setDraft(title);
                setEditing(true);
              }}
            >
              <Pencil className="h-4 w-4" />
            </Button>
          </>
        )}
        <Badge variant={status}>{status}</Badge>
      </div>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      {status === "failed" && (
        <div className="mt-3 flex items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
          <p className="min-w-0 flex-1 text-xs leading-relaxed text-destructive">
            {failureReason ?? "Processing failed."}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void retry()}
            disabled={retrying}
            className="shrink-0"
          >
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
            {retrying ? "Retrying…" : "Retry"}
          </Button>
        </div>
      )}

      <div className="mt-4 flex flex-col gap-3 rounded-lg border border-border bg-bg-subtle p-3 sm:flex-row sm:items-center">
        <code className="min-w-0 truncate rounded-md bg-bg-elevated px-3 py-2 font-mono text-xs text-text-muted sm:flex-1">
          {shareUrl}
        </code>
        <div className="flex flex-wrap items-center gap-2">
          <CopyLinkButton url={shareUrl} className="shrink-0" />
          <Link
            href={`/v/${slug}`}
            target="_blank"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border-strong px-3 py-1.5 text-xs text-text-muted hover:border-accent hover:text-text"
          >
            View public
            <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </div>
  );
}
