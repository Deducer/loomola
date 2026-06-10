"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { MoreHorizontal, Trash2, FolderInput, Pencil, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { Folder } from "@/db/queries/folders";

export function RecordingCardMenu({
  recordingId,
  status,
  folders,
}: {
  recordingId: string;
  status: "uploading" | "transcribing" | "processing" | "ready" | "failed";
  folders: Folder[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [showMove, setShowMove] = useState(false);

  async function moveTo(folderId: string | null) {
    await fetch(`/api/recordings/${recordingId}/folder`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ folderId }),
    });
    setOpen(false);
    setShowMove(false);
    router.refresh();
  }

  async function handleRetry() {
    setOpen(false);
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
    toast.success("Retry started.");
    router.refresh();
  }

  async function handleDelete() {
    if (!confirm("Delete this recording?")) return;
    await fetch(`/api/recordings/${recordingId}`, { method: "DELETE" });
    setOpen(false);
    router.refresh();
  }

  return (
    <div
      className="relative"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 !bg-white !text-neutral-950 shadow-sm hover:!bg-white/90"
        onClick={() => setOpen(!open)}
        aria-label="Card actions"
      >
        <MoreHorizontal className="h-3.5 w-3.5" />
      </Button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => {
              setOpen(false);
              setShowMove(false);
            }}
          />
          <div className="absolute right-0 top-8 z-50 w-48 rounded-md border border-border-strong bg-bg-elevated p-1 text-sm shadow-lg">
            {showMove ? (
              <>
                <button
                  type="button"
                  onClick={() => setShowMove(false)}
                  className="mb-1 w-full rounded px-2 py-1.5 text-left text-text-subtle hover:bg-bg-subtle hover:text-text-muted"
                >
                  ← Back
                </button>
                <button
                  type="button"
                  onClick={() => moveTo(null)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-text-muted hover:bg-bg-subtle hover:text-text"
                >
                  Unfiled
                </button>
                {folders.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => moveTo(f.id)}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-text-muted hover:bg-bg-subtle hover:text-text"
                  >
                    {f.name}
                  </button>
                ))}
              </>
            ) : (
              <>
                <Link
                  href={`/recordings/${recordingId}/edit`}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-text-muted hover:bg-bg-subtle hover:text-text"
                  onClick={() => setOpen(false)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Edit
                </Link>
                <button
                  type="button"
                  onClick={() => setShowMove(true)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-text-muted hover:bg-bg-subtle hover:text-text"
                >
                  <FolderInput className="h-3.5 w-3.5" />
                  Move to folder
                </button>
                {status === "failed" && (
                  <button
                    type="button"
                    onClick={() => void handleRetry()}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-text-muted hover:bg-bg-subtle hover:text-text"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Retry processing
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleDelete}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
