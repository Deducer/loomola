"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AudioWaveform,
  CalendarClock,
  Check,
  FileAudio,
  Folder,
  FolderInput,
  MousePointer2,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FolderSuggestionPill } from "./folder-suggestion-pill";
import { cn } from "@/lib/cn";
import type { Folder as DbFolder } from "@/db/queries/folders";
import type { RecordingWithBrand } from "@/db/queries/recordings";

export function NotesList({
  notes,
  folders,
  attachmentUrls = {},
}: {
  notes: RecordingWithBrand[];
  folders: DbFolder[];
  attachmentUrls?: Record<string, string[]>;
}) {
  const router = useRouter();
  const folderNames = useMemo(
    () => new Map(folders.map((folder) => [folder.id, folder.name])),
    [folders]
  );
  const groups = useMemo(() => groupNotesByDay(notes), [notes]);

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showMove, setShowMove] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectionActive = selectedIds.length > 0;

  // Flat ordered list of note ids (date-grouped, top to bottom) — used
  // for shift-click range selection.
  const orderedIds = useMemo(
    () => groups.flatMap((g) => g.notes.map((n) => n.id)),
    [groups]
  );

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
    setConfirmingDelete(false);
    setShowMove(false);
    setSelectedIds((current) => {
      if (range && lastSelectedId) {
        const from = orderedIds.indexOf(lastSelectedId);
        const to = orderedIds.indexOf(id);
        if (from >= 0 && to >= 0) {
          const [start, end] = from < to ? [from, to] : [to, from];
          return Array.from(
            new Set([...current, ...orderedIds.slice(start, end + 1)])
          );
        }
      }
      return current.includes(id)
        ? current.filter((sid) => sid !== id)
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
    toast.success(`Deleted ${count} note${count === 1 ? "" : "s"}.`);
    router.refresh();
  }

  async function moveSelected(folderId: string | null) {
    const results = await Promise.all(
      selectedIds.map((id) =>
        fetch(`/api/recordings/${id}/folder`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ folderId }),
        })
      )
    );
    if (results.some((res) => !res.ok)) {
      toast.error("Move failed for one or more notes.");
      return;
    }
    setSelectedIds([]);
    setShowMove(false);
    setConfirmingDelete(false);
    toast.success("Notes moved.");
    router.refresh();
  }

  return (
    <>
      <div className="space-y-8">
        {groups.map((group) => (
          <section key={group.label}>
            <h2 className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-subtle">
              {group.label}
            </h2>
            <div className="overflow-hidden rounded-lg border border-border bg-bg-subtle/55 shadow-sm shadow-black/10">
              {group.notes.map((note) => {
                const folderName = note.folderId
                  ? folderNames.get(note.folderId)
                  : null;
                const title = note.title || note.aiTitle || "New note";
                const duration = formatDuration(note.durationSeconds);
                const isSelected = selectedSet.has(note.id);
                return (
                  <NoteRow
                    key={note.id}
                    note={note}
                    title={title}
                    folderName={folderName ?? null}
                    duration={duration}
                    folderNames={folderNames}
                    attachments={attachmentUrls[note.id] ?? []}
                    selectionActive={selectionActive}
                    selected={isSelected}
                    onToggleSelected={toggleSelected}
                  />
                );
              })}
            </div>
          </section>
        ))}
      </div>

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
                setSelectedIds(orderedIds);
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
              className={
                confirmingDelete ? "ring-2 ring-destructive/30" : undefined
              }
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

function NoteRow({
  note,
  title,
  folderName,
  duration,
  folderNames,
  attachments,
  selectionActive,
  selected,
  onToggleSelected,
}: {
  note: RecordingWithBrand;
  title: string;
  folderName: string | null;
  duration: string | null;
  folderNames: Map<string, string>;
  attachments: ReadonlyArray<string>;
  selectionActive: boolean;
  selected: boolean;
  onToggleSelected: (id: string, range?: boolean) => void;
}) {
  return (
    <Link
      href={`/notes/${note.slug}`}
      onClick={(e) => {
        if (selectionActive) {
          e.preventDefault();
          onToggleSelected(note.id, e.shiftKey);
        }
      }}
      className={cn(
        "group relative grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 border-b border-border px-3 py-3 transition-colors last:border-b-0 hover:bg-bg-elevated/70 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:px-4",
        selected && "bg-accent/10"
      )}
    >
      <div className="relative">
        <NoteRowIcon status={note.status} attachments={attachments} />
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onToggleSelected(note.id, e.shiftKey);
          }}
          className={cn(
            "absolute -left-1 -top-1 z-10 flex h-5 w-5 items-center justify-center rounded-md border border-white/80 !bg-white !text-neutral-950 shadow-sm transition-opacity hover:!bg-white/90",
            selectionActive || selected
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100",
            selected && "border-accent !bg-accent !text-accent-fg"
          )}
          aria-label={selected ? "Deselect note" : "Select note"}
          aria-pressed={selected}
        >
          {selected ? <Check className="h-3.5 w-3.5" /> : null}
        </button>
      </div>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium leading-5 text-text">
          {title}
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-subtle">
          <span className="inline-flex items-center gap-1">
            <UserRound className="h-3.5 w-3.5 opacity-80" />
            {attendeeLabel(note.attendees)}
          </span>
          <span className="inline-flex items-center gap-1">
            <CalendarClock className="h-3.5 w-3.5 opacity-80" />
            {timeLabel(new Date(note.createdAt))}
          </span>
          {duration && (
            <span className="inline-flex items-center gap-1">{duration}</span>
          )}
        </span>
      </span>
      <span className="col-start-2 mt-2 flex items-center gap-2 sm:col-start-auto sm:mt-0">
        {note.status !== "ready" && (
          <Badge variant={note.status}>{note.status}</Badge>
        )}
        {folderName && (
          <span className="hidden max-w-36 items-center gap-1 rounded-full border border-border bg-bg-elevated px-2.5 py-1 text-xs text-text-muted sm:inline-flex">
            <Folder className="h-3.5 w-3.5" />
            <span className="truncate">{folderName}</span>
          </span>
        )}
        {!note.folderId && note.suggestedFolderId
          ? (() => {
              const suggested = folderNames.get(note.suggestedFolderId);
              if (!suggested) return null;
              return (
                <FolderSuggestionPill
                  recordingId={note.id}
                  recordingTitle={title}
                  suggestedFolderId={note.suggestedFolderId}
                  suggestedFolderName={suggested}
                />
              );
            })()
          : null}
      </span>
    </Link>
  );
}

export function noteDayLabel(date: Date, now = new Date()): string {
  const day = startOfDay(date);
  const today = startOfDay(now);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  if (day.getTime() === today.getTime()) return "Today";
  if (day.getTime() === yesterday.getTime()) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function groupNotesByDay(notes: RecordingWithBrand[]) {
  const groups = new Map<string, RecordingWithBrand[]>();
  for (const note of notes) {
    const label = noteDayLabel(new Date(note.createdAt));
    groups.set(label, [...(groups.get(label) ?? []), note]);
  }
  return Array.from(groups, ([label, groupNotes]) => ({ label, notes: groupNotes }));
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function timeLabel(date: Date): string {
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDuration(secondsValue: string | number | null): string | null {
  if (secondsValue === null) return null;
  const seconds = Math.round(Number(secondsValue));
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function attendeeLabel(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) return "Me";
  const names = value.filter((item): item is string => typeof item === "string");
  if (names.length === 0) return "Me";
  if (names.length <= 2) return names.join(", ");
  return `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
}

/**
 * Row-leading icon for the notes list. When the note has 1+ attached
 * images, render those instead of the generic waveform/file icon — 1
 * image fills the box, 2 images split half-and-half, 3-4 images render
 * a 2x2 grid. Mirrors how Granola previews attachments at a glance.
 */
function NoteRowIcon({
  status,
  attachments,
}: {
  status: RecordingWithBrand["status"];
  attachments: ReadonlyArray<string>;
}) {
  if (attachments.length === 0) {
    return (
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-bg-elevated text-emerald-400 transition-colors group-hover:border-emerald-500/25 group-hover:bg-emerald-500/10">
        {status === "ready" ? (
          <AudioWaveform className="h-4 w-4" />
        ) : (
          <FileAudio className="h-4 w-4" />
        )}
      </span>
    );
  }

  const tiles = attachments.slice(0, 4);
  const layoutClass =
    tiles.length === 1
      ? "grid-cols-1 grid-rows-1"
      : tiles.length === 2
        ? "grid-cols-2 grid-rows-1"
        : "grid-cols-2 grid-rows-2";

  return (
    <span
      className={`grid h-9 w-9 shrink-0 overflow-hidden rounded-md border border-border bg-bg-elevated transition-colors group-hover:border-emerald-500/25 ${layoutClass} gap-px`}
      aria-hidden
    >
      {tiles.map((url, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={i}
          src={url}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover"
        />
      ))}
    </span>
  );
}
