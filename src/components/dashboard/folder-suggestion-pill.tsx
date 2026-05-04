"use client";

import { useState } from "react";
import { Check, Folder as FolderIcon, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/cn";

type Phase = "idle" | "submitting" | "done";

export function FolderSuggestionPill({
  recordingId,
  recordingTitle,
  suggestedFolderId,
  suggestedFolderName,
  onAccepted,
  onDismissed,
  className,
}: {
  recordingId: string;
  recordingTitle: string;
  suggestedFolderId: string;
  suggestedFolderName: string;
  onAccepted?: (folderId: string) => void;
  onDismissed?: () => void;
  className?: string;
}) {
  const [phase, setPhase] = useState<Phase>("idle");

  async function handleAccept(e: React.MouseEvent) {
    // Cards are wrapped in <Link>, so all events have to stop bubbling
    // before they trigger navigation.
    e.preventDefault();
    e.stopPropagation();
    if (phase !== "idle") return;
    setPhase("submitting");
    try {
      const res = await fetch(
        `/api/recordings/${recordingId}/suggested-folder/accept`,
        { method: "POST", headers: { "content-type": "application/json" } }
      );
      if (!res.ok) {
        if (res.status === 409) {
          // Already cleared by another tab; treat as a benign no-op.
          setPhase("done");
          onDismissed?.();
          return;
        }
        throw new Error(`accept_failed_${res.status}`);
      }
      const body = (await res.json()) as {
        folderId: string;
        folderName: string;
      };
      setPhase("done");
      const truncated =
        recordingTitle.length > 60
          ? recordingTitle.slice(0, 60) + "…"
          : recordingTitle;
      toast.success(`Added "${truncated}" to ${body.folderName}`);
      onAccepted?.(body.folderId);
    } catch (err) {
      console.error("[folder-suggestion-pill] accept failed:", err);
      setPhase("idle");
      toast.error("Couldn't move recording. Try again.");
    }
  }

  async function handleDismiss(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (phase !== "idle") return;
    setPhase("submitting");
    try {
      const res = await fetch(
        `/api/recordings/${recordingId}/suggested-folder/dismiss`,
        { method: "POST", headers: { "content-type": "application/json" } }
      );
      if (!res.ok && res.status !== 404) {
        throw new Error(`dismiss_failed_${res.status}`);
      }
      setPhase("done");
      onDismissed?.();
    } catch (err) {
      console.error("[folder-suggestion-pill] dismiss failed:", err);
      setPhase("idle");
    }
  }

  if (phase === "done") return null;

  void suggestedFolderId;

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-border bg-bg-elevated/95 py-1 pl-2.5 pr-1 text-xs shadow-sm shadow-black/20 backdrop-blur transition-opacity duration-200",
        phase === "submitting" && "pointer-events-none opacity-60",
        className
      )}
      onClick={(e) => e.stopPropagation()}
      role="group"
      aria-label={`Suggest moving to ${suggestedFolderName}`}
    >
      <FolderIcon className="h-3.5 w-3.5 shrink-0 text-text-muted" />
      <span className="max-w-32 truncate font-medium text-text-muted">
        {suggestedFolderName}
      </span>
      <button
        type="button"
        onClick={handleAccept}
        className="flex h-5 w-5 items-center justify-center rounded-full text-emerald-400 transition-colors hover:bg-emerald-500/15 disabled:opacity-50"
        disabled={phase !== "idle"}
        aria-label={`Move to ${suggestedFolderName}`}
        title={`Move to ${suggestedFolderName}`}
      >
        <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
      </button>
      <button
        type="button"
        onClick={handleDismiss}
        className="flex h-5 w-5 items-center justify-center rounded-full text-text-subtle transition-colors hover:bg-bg-subtle hover:text-red-400 disabled:opacity-50"
        disabled={phase !== "idle"}
        aria-label="Dismiss folder suggestion"
        title="Dismiss"
      >
        <X className="h-3.5 w-3.5" strokeWidth={2.5} />
      </button>
    </div>
  );
}
