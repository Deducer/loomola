"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FolderInput, MousePointer2, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { RecordingCard } from "./recording-card";
import { Button } from "@/components/ui/button";
import type { RecordingWithBrand } from "@/db/queries/recordings";
import type { Folder } from "@/db/queries/folders";

export function RecordingsGrid({
  recordings,
  thumbnailUrls,
  previewUrls,
  folders,
}: {
  recordings: RecordingWithBrand[];
  thumbnailUrls: Record<string, string | null>;
  previewUrls: Record<string, string | null>;
  folders: Folder[];
}) {
  const router = useRouter();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showMove, setShowMove] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectionActive = selectedIds.length > 0;

  useEffect(() => {
    if (!selectionActive) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSelectedIds([]);
        setShowMove(false);
        setConfirmingDelete(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectionActive]);

  function toggleSelected(id: string, range = false) {
    const recordingIds = recordings.map((recording) => recording.id);
    setConfirmingDelete(false);
    setShowMove(false);

    setSelectedIds((current) => {
      if (range && lastSelectedId) {
        const from = recordingIds.indexOf(lastSelectedId);
        const to = recordingIds.indexOf(id);
        if (from >= 0 && to >= 0) {
          const [start, end] = from < to ? [from, to] : [to, from];
          return Array.from(
            new Set([...current, ...recordingIds.slice(start, end + 1)])
          );
        }
      }

      return current.includes(id)
        ? current.filter((selectedId) => selectedId !== id)
        : [...current, id];
    });
    setLastSelectedId(id);
  }

  async function deleteSelected() {
    const count = selectedIds.length;
    if (count === 0) return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      setShowMove(false);
      return;
    }

    const res = await fetch("/api/recordings/bulk-delete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: selectedIds }),
    });

    if (!res.ok) {
      toast.error(`Delete failed (${res.status}).`);
      return;
    }

    setSelectedIds([]);
    setShowMove(false);
    setConfirmingDelete(false);
    toast.success(`Deleted ${count} recording${count === 1 ? "" : "s"}.`);
    router.refresh();
  }

  async function moveSelected(folderId: string | null) {
    const results = await Promise.all(
      selectedIds.map((recordingId) =>
        fetch(`/api/recordings/${recordingId}/folder`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ folderId }),
        })
      )
    );
    if (results.some((res) => !res.ok)) {
      toast.error("Move failed for one or more recordings.");
      return;
    }
    setSelectedIds([]);
    setShowMove(false);
    setConfirmingDelete(false);
    toast.success("Recordings moved.");
    router.refresh();
  }

  return (
    <>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {recordings.map((r) => (
          <li key={r.id}>
            <RecordingCard
              rec={r}
              thumbnailUrl={thumbnailUrls[r.id] ?? null}
              previewUrl={previewUrls[r.id] ?? null}
              folders={folders}
              selectionActive={selectionActive}
              selected={selectedSet.has(r.id)}
              onToggleSelected={toggleSelected}
            />
          </li>
        ))}
      </ul>

      {selectionActive && (
        <div className="fixed inset-x-0 bottom-5 z-50 flex justify-center px-4">
          <div className="flex max-w-full items-center gap-2 rounded-lg border border-border-strong bg-bg-elevated px-3 py-2 text-sm text-text shadow-lg">
            <span className="whitespace-nowrap font-medium">
              {selectedIds.length} selected
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSelectedIds(recordings.map((r) => r.id));
                setShowMove(false);
                setConfirmingDelete(false);
              }}
            >
              <MousePointer2 className="h-4 w-4" />
              Select all
            </Button>
            <div className="relative">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowMove((open) => !open);
                  setConfirmingDelete(false);
                }}
              >
                <FolderInput className="h-4 w-4" />
                Move
              </Button>
              {showMove && (
                <div className="absolute bottom-10 left-0 w-52 rounded-md border border-border-strong bg-bg-elevated p-1 text-sm shadow-lg">
                  <button
                    type="button"
                    onClick={() => moveSelected(null)}
                    className="flex w-full items-center rounded px-2 py-1.5 text-left text-text-muted hover:bg-bg-subtle hover:text-text"
                  >
                    Unfiled
                  </button>
                  {folders.map((folder) => (
                    <button
                      key={folder.id}
                      type="button"
                      onClick={() => moveSelected(folder.id)}
                      className="flex w-full items-center rounded px-2 py-1.5 text-left text-text-muted hover:bg-bg-subtle hover:text-text"
                    >
                      {folder.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <Button
              variant="destructive"
              size="sm"
              onClick={deleteSelected}
              className={confirmingDelete ? "ring-2 ring-destructive/30" : undefined}
            >
              <Trash2 className="h-4 w-4" />
              {confirmingDelete ? "Confirm delete" : "Delete"}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => {
                setSelectedIds([]);
                setShowMove(false);
                setConfirmingDelete(false);
              }}
              aria-label="Cancel selection"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
