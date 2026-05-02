import Link from "next/link";
import { AudioWaveform, CalendarClock, FileAudio, Folder, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { Folder as DbFolder } from "@/db/queries/folders";
import type { RecordingWithBrand } from "@/db/queries/recordings";

export function NotesList({
  notes,
  folders,
}: {
  notes: RecordingWithBrand[];
  folders: DbFolder[];
}) {
  const folderNames = new Map(folders.map((folder) => [folder.id, folder.name]));
  const groups = groupNotesByDay(notes);

  return (
    <div className="space-y-8">
      {groups.map((group) => (
        <section key={group.label}>
          <h2 className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-text-subtle">
            {group.label}
          </h2>
          <div className="overflow-hidden rounded-lg border border-border bg-bg-subtle/55 shadow-sm shadow-black/10">
            {group.notes.map((note) => {
              const folderName = note.folderId ? folderNames.get(note.folderId) : null;
              const title = note.title || note.aiTitle || "New note";
              const duration = formatDuration(note.durationSeconds);
              return (
                <Link
                  key={note.id}
                  href={`/notes/${note.slug}`}
                  className="group grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 border-b border-border px-3 py-3 transition-colors last:border-b-0 hover:bg-bg-elevated/70 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:px-4"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-bg-elevated text-emerald-400 transition-colors group-hover:border-emerald-500/25 group-hover:bg-emerald-500/10">
                    {note.status === "ready" ? (
                      <AudioWaveform className="h-4 w-4" />
                    ) : (
                      <FileAudio className="h-4 w-4" />
                    )}
                  </span>
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
                        <span className="inline-flex items-center gap-1">
                          {duration}
                        </span>
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
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </div>
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
