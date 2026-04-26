"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
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
}: {
  recordingId: string;
  slug: string;
  title: string;
  status: "uploading" | "transcribing" | "processing" | "ready" | "failed";
  shareUrl: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

      <div className="mt-4 flex items-center gap-3 rounded-lg border border-border bg-bg-subtle p-3">
        <code className="flex-1 truncate rounded-md bg-bg-elevated px-3 py-2 font-mono text-xs text-text-muted">
          {shareUrl}
        </code>
        <CopyLinkButton url={shareUrl} />
        <Link
          href={`/v/${slug}`}
          target="_blank"
          className="rounded-md border border-border-strong px-3 py-1.5 text-xs text-text-muted hover:border-accent hover:text-text"
        >
          View public →
        </Link>
      </div>
    </div>
  );
}
