"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowLeft,
  Calendar,
  Check,
  ChevronUp,
  CircleAlert,
  FileDown,
  FileJson,
  FileText,
  Folder,
  HardDriveDownload,
  ImagePlus,
  LoaderCircle,
  MoreHorizontal,
  Pause,
  Play,
  RefreshCcw,
  Sparkles,
  Trash2,
  Users,
  Volume2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { TranscriptPanel } from "@/components/viewer/transcript-panel";
import type {
  TranscriptPerson,
  TranscriptSpeakerAssignment,
} from "@/components/viewer/transcript-panel";
import type { Word } from "@/lib/viewer/paragraphs";
import { cn } from "@/lib/cn";

type NotePageClientProps = {
  mediaId: string;
  initialTitle: string | null;
  createdAt: string;
  status: "uploading" | "transcribing" | "processing" | "ready" | "failed";
  durationSeconds: string | null;
  attendees: unknown;
  folderLabel: string | null;
  initialBody: string;
  audioUrl: string | null;
  waveformUrl: string | null;
  transcriptText: string;
  transcriptWords: Word[];
  initialAttachments: NoteAttachment[];
  initialEnhancedSummary: string | null;
  initialGenerationStatus: GenerationStatus;
  initialObsidianSaveState: ObsidianSaveState;
  initialObsidianPath: string;
  people: TranscriptPerson[];
  speakerAssignments: TranscriptSpeakerAssignment[];
};

type SaveState = "idle" | "saving" | "saved" | "error";
type GenerationStatus = "idle" | "pending" | "streaming" | "complete" | "failed";
type NoteViewMode = "original" | "enhanced";
type ObsidianSaveState = "idle" | "saving" | "queued" | "synced" | "error";
type AttachmentSaveState = "idle" | "uploading" | "error";

type NoteAttachment = {
  id: string;
  filename: string;
  contentType: string;
  byteSize: number;
  createdAt: string;
  url: string;
};

export function NotePageClient({
  mediaId,
  initialTitle,
  createdAt,
  status,
  durationSeconds,
  attendees,
  folderLabel,
  initialBody,
  audioUrl,
  waveformUrl,
  transcriptText,
  transcriptWords,
  initialAttachments,
  initialEnhancedSummary,
  initialGenerationStatus,
  initialObsidianSaveState,
  initialObsidianPath,
  people,
  speakerAssignments,
}: NotePageClientProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [body, setBody] = useState(initialBody);
  const [title, setTitle] = useState(initialTitle ?? "");
  const [lastSavedBody, setLastSavedBody] = useState(initialBody);
  const [lastSavedTitle, setLastSavedTitle] = useState(initialTitle ?? "");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [titleState, setTitleState] = useState<SaveState>("idle");
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [speakerAssignmentsState, setSpeakerAssignmentsState] =
    useState(speakerAssignments);
  const [enhancedSummary, setEnhancedSummary] = useState(initialEnhancedSummary);
  const [generationStatus, setGenerationStatus] = useState<GenerationStatus>(
    initialGenerationStatus
  );
  const [enhanceError, setEnhanceError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<NoteViewMode>(
    initialEnhancedSummary ? "enhanced" : "original"
  );
  const [actionsOpen, setActionsOpen] = useState(false);
  const [obsidianSaveState, setObsidianSaveState] =
    useState<ObsidianSaveState>(initialObsidianSaveState);
  const [obsidianPath, setObsidianPath] = useState<string | null>(
    initialObsidianPath
  );
  const [attachments, setAttachments] = useState(initialAttachments);
  const [attachmentState, setAttachmentState] =
    useState<AttachmentSaveState>("idle");
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [draggingAttachment, setDraggingAttachment] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);

  const meetingDate = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(new Date(createdAt)),
    [createdAt]
  );
  const durationLabel = useMemo(() => {
    const seconds = Math.round(Number(durationSeconds ?? 0));
    if (!Number.isFinite(seconds) || seconds <= 0) return null;
    return formatAudioTime(seconds);
  }, [durationSeconds]);
  const progressPercent = useMemo(() => {
    const seconds = Number(durationSeconds ?? 0);
    if (!Number.isFinite(seconds) || seconds <= 0) return 0;
    return Math.min(100, Math.max(0, (currentTime / seconds) * 100));
  }, [currentTime, durationSeconds]);
  const attendeeLabel = useMemo(() => {
    if (!Array.isArray(attendees) || attendees.length === 0) return "Me";
    return `${attendees.length + 1} people`;
  }, [attendees]);

  useEffect(() => {
    if (body === lastSavedBody) return;
    setSaveState("saving");
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/notes/${mediaId}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ body }),
        });
        if (!response.ok) throw new Error("save_failed");
        setLastSavedBody(body);
        setSaveState("saved");
      } catch {
        setSaveState("error");
      }
    }, 600);
    return () => window.clearTimeout(timer);
  }, [body, lastSavedBody, mediaId]);

  const refreshEnhancement = useCallback(async () => {
    const response = await fetch(`/api/notes/${mediaId}/enhance`);
    if (!response.ok) throw new Error("enhance_status_failed");
    const data = (await response.json()) as {
      titleSuggested: string | null;
      summary: string | null;
      generationStatus: GenerationStatus;
    };

    setGenerationStatus(data.generationStatus);
    if (data.summary) {
      setEnhancedSummary(data.summary);
      setViewMode("enhanced");
      setEnhanceError(null);
    }
    if (data.titleSuggested && !title.trim() && !lastSavedTitle.trim()) {
      setTitle(data.titleSuggested);
      setLastSavedTitle(data.titleSuggested);
    }
  }, [lastSavedTitle, mediaId, title]);

  useEffect(() => {
    if (generationStatus !== "pending" && generationStatus !== "streaming") {
      return;
    }

    let cancelled = false;
    const tick = async () => {
      try {
        await refreshEnhancement();
      } catch {
        if (!cancelled) setEnhanceError("Could not refresh generated notes.");
      }
    };

    void tick();
    const timer = window.setInterval(tick, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [generationStatus, refreshEnhancement]);

  const refreshObsidianStatus = useCallback(async () => {
    const response = await fetch(`/api/notes/${mediaId}/obsidian-status`);
    if (!response.ok) throw new Error("obsidian_status_failed");
    const data = (await response.json()) as {
      status: "idle" | "queued" | "synced";
      path: string;
    };
    setObsidianSaveState(data.status);
    setObsidianPath(data.path);
  }, [mediaId]);

  useEffect(() => {
    if (!actionsOpen) return;
    void refreshObsidianStatus().catch(() => undefined);
  }, [actionsOpen, refreshObsidianStatus]);

  useEffect(() => {
    if (obsidianSaveState !== "queued") return;
    const timer = window.setInterval(() => {
      void refreshObsidianStatus().catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [obsidianSaveState, refreshObsidianStatus]);

  async function saveTitle() {
    const trimmed = title.trim();
    if (!trimmed || trimmed === lastSavedTitle) return;
    setTitleState("saving");
    try {
      const response = await fetch(`/api/recordings/${mediaId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: trimmed }),
      });
      if (!response.ok) throw new Error("title_failed");
      setLastSavedTitle(trimmed);
      setTitleState("saved");
    } catch {
      setTitleState("error");
    }
  }

  async function saveBodyNow() {
    if (body === lastSavedBody) return;
    setSaveState("saving");
    const response = await fetch(`/api/notes/${mediaId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body }),
    });
    if (!response.ok) throw new Error("save_failed");
    setLastSavedBody(body);
    setSaveState("saved");
  }

  async function generateNotes() {
    if (!transcriptText.trim()) return;
    setGenerationStatus("pending");
    setEnhanceError(null);
    setEnhancedSummary(null);
    setViewMode("original");
    try {
      await saveBodyNow();
      const response = await fetch(`/api/notes/${mediaId}/enhance`, {
        method: "POST",
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(
          typeof data.error === "string" ? data.error : "enhance_failed"
        );
      }
      await refreshEnhancement();
    } catch (err) {
      setGenerationStatus("failed");
      setEnhanceError(
        err instanceof Error && err.message === "transcript_not_ready"
          ? "Transcript is still processing."
          : "Could not generate notes."
      );
    }
  }

  async function requestObsidianSave() {
    setObsidianSaveState("saving");
    try {
      const response = await fetch(`/api/notes/${mediaId}/obsidian-save`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!response.ok) throw new Error("obsidian_save_failed");
      const data = (await response.json()) as { path?: string; status?: string };
      setObsidianPath(typeof data.path === "string" ? data.path : null);
      setObsidianSaveState(data.status === "queued" ? "queued" : "idle");
    } catch {
      setObsidianSaveState("error");
    }
  }

  async function uploadAttachmentFiles(files: File[]) {
    const imageFiles = files.filter((file) => file.type.startsWith("image/"));
    if (imageFiles.length === 0) return;

    setAttachmentState("uploading");
    setAttachmentError(null);
    try {
      for (const file of imageFiles) {
        const formData = new FormData();
        formData.append("file", file);
        const response = await fetch(`/api/notes/${mediaId}/attachments`, {
          method: "POST",
          body: formData,
        });
        const data = (await response.json().catch(() => ({}))) as {
          attachment?: NoteAttachment;
          error?: string;
        };
        if (!response.ok || !data.attachment) {
          throw new Error(data.error ?? "attachment_upload_failed");
        }
        setAttachments((current) => [data.attachment!, ...current]);
      }
      setAttachmentState("idle");
    } catch {
      setAttachmentState("error");
      setAttachmentError("Could not attach image.");
    }
  }

  async function removeAttachment(attachmentId: string) {
    const previous = attachments;
    setAttachments((current) =>
      current.filter((attachment) => attachment.id !== attachmentId)
    );
    try {
      const response = await fetch(
        `/api/notes/${mediaId}/attachments/${attachmentId}`,
        { method: "DELETE" }
      );
      if (!response.ok) throw new Error("delete_failed");
    } catch {
      setAttachments(previous);
      setAttachmentError("Could not remove image.");
    }
  }

  function handleAttachmentDrag(event: DragEvent<HTMLElement>) {
    if (!hasDraggedImage(event)) return;
    event.preventDefault();
    setDraggingAttachment(true);
  }

  function handleAttachmentDragLeave(event: DragEvent<HTMLElement>) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setDraggingAttachment(false);
  }

  function handleAttachmentDrop(event: DragEvent<HTMLElement>) {
    if (!hasDraggedImage(event)) return;
    event.preventDefault();
    setDraggingAttachment(false);
    void uploadAttachmentFiles(Array.from(event.dataTransfer.files));
  }

  function seekTo(sec: number) {
    if (!audioRef.current) return;
    audioRef.current.currentTime = sec;
    setCurrentTime(sec);
    audioRef.current.play().catch(() => undefined);
  }

  function togglePlay() {
    if (!audioRef.current) return;
    if (audioRef.current.paused) {
      audioRef.current.play().catch(() => undefined);
    } else {
      audioRef.current.pause();
    }
  }

  return (
    <div
      className="min-h-screen bg-bg pb-32 text-text"
      onDragEnter={handleAttachmentDrag}
      onDragOver={handleAttachmentDrag}
      onDragLeave={handleAttachmentDragLeave}
      onDrop={handleAttachmentDrop}
    >
      {draggingAttachment && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-sm">
          <div className="rounded-2xl border border-dashed border-emerald-400/70 bg-bg-elevated/95 px-8 py-6 text-center shadow-2xl shadow-black/40">
            <ImagePlus className="mx-auto h-7 w-7 text-emerald-400" />
            <p className="mt-3 text-sm font-semibold text-text">
              Drop images to attach
            </p>
            <p className="mt-1 text-xs text-text-subtle">
              Screenshots, slides, whiteboards, and product screens become note context.
            </p>
          </div>
        </div>
      )}
      <main className="mx-auto flex min-h-screen w-full max-w-[760px] flex-col px-4 py-4 sm:px-6 sm:py-7">
        <div className="sticky top-0 z-20 -mx-4 flex items-center justify-between border-b border-border/70 bg-bg/95 px-4 py-3 text-text-subtle backdrop-blur sm:-mx-6 sm:px-6">
          <Link href="/" aria-label="Back to dashboard">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full hover:bg-bg-subtle"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="flex items-center gap-2">
            {enhancedSummary && (
              <div className="flex rounded-lg border border-border bg-bg-subtle/80 p-0.5">
                <button
                  type="button"
                  onClick={() => setViewMode("enhanced")}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                    viewMode === "enhanced"
                      ? "bg-bg-elevated text-text"
                      : "text-text-muted hover:text-text"
                  )}
                >
                  Enhanced
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("original")}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                    viewMode === "original"
                      ? "bg-bg-elevated text-text"
                      : "text-text-muted hover:text-text"
                  )}
                >
                  Original
                </button>
              </div>
            )}
            <Badge variant={status}>{status}</Badge>
            <div className="relative">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setActionsOpen((open) => !open)}
                className="h-8 w-8 rounded-full hover:bg-bg-subtle"
                aria-label="More note actions"
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
              {actionsOpen && (
                <NoteActionsMenu
                  mediaId={mediaId}
                  obsidianSaveState={obsidianSaveState}
                  obsidianPath={obsidianPath}
                  onRequestObsidianSave={requestObsidianSave}
                />
              )}
            </div>
          </div>
        </div>

        <section className="mt-6">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={saveTitle}
            placeholder="New note"
            className={cn(
              "w-full border-none bg-transparent px-0 text-[1.5rem] font-semibold leading-tight tracking-normal text-text outline-none placeholder:font-serif placeholder:italic placeholder:text-text-subtle sm:text-[1.75rem]",
              !title.trim() && "italic text-text-subtle"
            )}
          />
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-text-muted">
            <span className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-bg-subtle/80 px-3">
              <Calendar className="h-3.5 w-3.5" />
              {meetingDate}
            </span>
            <span className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-bg-subtle/80 px-3">
              <Users className="h-3.5 w-3.5" />
              {attendeeLabel}
            </span>
            <span className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-bg-subtle/80 px-3">
              <Folder className="h-3.5 w-3.5" />
              {folderLabel ?? "Add to folder"}
            </span>
            {durationLabel && (
              <span className="inline-flex h-8 items-center rounded-full border border-border bg-bg-subtle/80 px-3 tabular-nums">
                {durationLabel}
              </span>
            )}
            <SaveIndicator state={titleState} />
          </div>
          <NoteAttachments
            attachments={attachments}
            state={attachmentState}
            error={attachmentError}
            onUpload={uploadAttachmentFiles}
            onRemove={removeAttachment}
          />
        </section>

        <section className="mt-6 flex-1">
          {viewMode === "enhanced" && enhancedSummary ? (
            <EnhancedMarkdown markdown={enhancedSummary} />
          ) : (
            <Textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="Write notes"
              className="min-h-[46vh] resize-none border-0 bg-transparent px-0 py-0 text-[1.03rem] leading-8 shadow-none placeholder:font-serif placeholder:italic placeholder:text-[1.12rem] placeholder:text-text-subtle focus-visible:ring-0 focus-visible:ring-offset-0"
            />
          )}
          <div className="mt-4 flex items-center gap-2 text-xs text-text-subtle">
            <SaveIndicator state={saveState} />
          </div>
          <EnhancementControls
            generationStatus={generationStatus}
            hasTranscript={!!transcriptText.trim()}
            hasEnhancedSummary={!!enhancedSummary}
            error={enhanceError}
            onGenerate={generateNotes}
          />
        </section>

        {transcriptOpen && (
          <section className="fixed inset-x-3 bottom-24 z-30 mx-auto max-h-[58vh] max-w-[760px] rounded-xl border border-border bg-bg-elevated/95 p-3 shadow-2xl shadow-black/35 backdrop-blur">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <FileText className="h-4 w-4 text-emerald-400" />
                Transcript
              </div>
              <div className="flex items-center gap-2">
                <span className="hidden rounded-full border border-border bg-bg-subtle px-2 py-1 text-xs text-text-muted sm:inline-flex">
                  English
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setTranscriptOpen(false)}
                  aria-label="Collapse transcript"
                >
                  <ChevronUp className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <TranscriptPanel
              mediaId={mediaId}
              words={transcriptWords}
              fullText={transcriptText}
              currentTime={currentTime}
              onSeek={seekTo}
              people={people}
              speakerAssignments={speakerAssignmentsState}
              onSpeakerAssignmentsChange={setSpeakerAssignmentsState}
              tone="neutral"
            />
          </section>
        )}
      </main>

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-4 pb-4 pt-3">
        <div className="pointer-events-auto mx-auto flex max-w-[760px] items-center gap-2 rounded-xl border border-border bg-bg-subtle/95 p-2 shadow-2xl shadow-black/35 backdrop-blur">
          <Button
            variant="secondary"
            size="icon"
            onClick={togglePlay}
            disabled={!audioUrl}
            className="h-10 w-10 shrink-0 rounded-lg border border-border bg-bg-elevated hover:bg-border-strong"
            aria-label={playing ? "Pause audio" : "Play audio"}
          >
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </Button>
          <button
            type="button"
            onClick={() => setTranscriptOpen((open) => !open)}
            className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-bg-elevated"
          >
            <Volume2 className="h-4 w-4 shrink-0 text-emerald-400" />
            <span className="relative min-w-0 flex-1 overflow-hidden rounded-md border border-border bg-bg">
              {waveformUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={waveformUrl}
                  alt=""
                  className="h-8 w-full object-cover opacity-80"
                />
              ) : (
                <span className="flex h-8 items-center px-2 text-sm text-text-muted">
                  {status === "ready" ? "Waveform unavailable" : "Processing"}
                </span>
              )}
              <span
                className="absolute inset-y-0 left-0 bg-emerald-500/10"
                style={{ width: `${progressPercent}%` }}
              />
              <span
                className="absolute bottom-0 left-0 h-0.5 bg-emerald-400"
                style={{ width: `${progressPercent}%` }}
              />
            </span>
            <span className="hidden w-[74px] shrink-0 text-right text-xs tabular-nums text-text-subtle sm:block">
              {formatAudioTime(currentTime)}
              {durationLabel ? ` / ${durationLabel}` : ""}
            </span>
          </button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setTranscriptOpen((open) => !open)}
            className="h-9 w-9 shrink-0 rounded-lg"
            aria-label="Toggle transcript"
          >
            <ChevronUp
              className={cn("h-4 w-4 transition-transform", transcriptOpen && "rotate-180")}
            />
          </Button>
        </div>
        {audioUrl && (
          <audio
            ref={audioRef}
            src={audioUrl}
            preload="metadata"
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
            onEnded={() => setPlaying(false)}
          />
        )}
      </div>
    </div>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === "idle") return null;
  if (state === "saving") {
    return (
      <span className="inline-flex items-center gap-1 text-text-subtle">
        <RefreshCcw className="h-3 w-3 animate-spin" />
        Saving
      </span>
    );
  }
  if (state === "error") {
    return (
      <span className="inline-flex items-center gap-1 text-red-400">
        <CircleAlert className="h-3 w-3" />
        Not saved
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-emerald-400">
      <Check className="h-3 w-3" />
      Saved
    </span>
  );
}

function NoteAttachments({
  attachments,
  state,
  error,
  onUpload,
  onRemove,
}: {
  attachments: NoteAttachment[];
  state: AttachmentSaveState;
  error: string | null;
  onUpload: (files: File[]) => void;
  onRemove: (attachmentId: string) => void;
}) {
  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-full border border-border bg-bg-subtle/80 px-3 text-sm font-medium text-text-muted transition-colors hover:bg-bg-elevated hover:text-text">
          <ImagePlus className="h-4 w-4 text-emerald-400" />
          {state === "uploading" ? "Attaching..." : "Attach images"}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            className="sr-only"
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files ?? []);
              event.currentTarget.value = "";
              onUpload(files);
            }}
          />
        </label>
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>

      {attachments.length > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {attachments.map((attachment) => (
            <div
              key={attachment.id}
              className="group relative overflow-hidden rounded-lg border border-border bg-bg-subtle"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={attachment.url}
                alt={attachment.filename}
                className="aspect-[4/3] w-full object-cover"
              />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                <p className="truncate text-xs font-medium text-white">
                  {attachment.filename}
                </p>
                <p className="text-[11px] text-white/60">
                  {formatAttachmentSize(attachment.byteSize)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onRemove(attachment.id)}
                className="absolute right-1.5 top-1.5 inline-flex h-7 w-7 items-center justify-center rounded-full bg-black/65 text-white opacity-0 transition-opacity hover:bg-red-500/80 group-hover:opacity-100"
                aria-label={`Remove ${attachment.filename}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NoteActionsMenu({
  mediaId,
  obsidianSaveState,
  obsidianPath,
  onRequestObsidianSave,
}: {
  mediaId: string;
  obsidianSaveState: ObsidianSaveState;
  obsidianPath: string | null;
  onRequestObsidianSave: () => void;
}) {
  return (
    <div className="absolute right-0 top-10 z-50 w-72 overflow-hidden rounded-lg border border-border bg-bg-elevated p-1.5 text-sm shadow-2xl shadow-black/35">
      <MenuDownloadLink
        href={`/api/notes/${mediaId}/export.md`}
        icon={<FileDown className="h-4 w-4" />}
        label="Download full meeting .md"
      />
      <MenuDownloadLink
        href={`/api/notes/${mediaId}/transcript.md`}
        icon={<FileText className="h-4 w-4" />}
        label="Download transcript .md"
      />
      <MenuDownloadLink
        href={`/api/notes/${mediaId}/export.json`}
        icon={<FileJson className="h-4 w-4" />}
        label="Download note .json"
      />
      <div className="my-1 border-t border-border" />
      <button
        type="button"
        onClick={onRequestObsidianSave}
        disabled={obsidianSaveState === "saving"}
        className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-text-muted transition-colors hover:bg-bg-subtle hover:text-text disabled:opacity-60"
      >
        <HardDriveDownload className="h-4 w-4 text-emerald-400" />
        <span className="min-w-0 flex-1">
          <span className="block">
            {obsidianSaveState === "saving"
              ? "Queueing Obsidian save"
              : obsidianSaveState === "queued"
                ? "Queued for Obsidian"
                : obsidianSaveState === "synced"
                  ? "Synced to Obsidian"
                : "Save to Obsidian"}
          </span>
          {obsidianPath && (
            <span className="mt-0.5 block truncate font-mono text-[11px] text-text-subtle">
              {obsidianPath}
            </span>
          )}
          {obsidianSaveState === "synced" && (
            <span className="mt-0.5 block text-[11px] text-text-subtle">
              Click to save again.
            </span>
          )}
          {obsidianSaveState === "error" && (
            <span className="mt-0.5 block text-[11px] text-red-400">
              Could not queue save.
            </span>
          )}
        </span>
      </button>
    </div>
  );
}

function MenuDownloadLink({
  href,
  icon,
  label,
}: {
  href: string;
  icon: ReactNode;
  label: string;
}) {
  return (
    <a
      href={href}
      className="flex items-center gap-2 rounded-md px-2.5 py-2 text-text-muted transition-colors hover:bg-bg-subtle hover:text-text"
    >
      <span className="text-text-subtle">{icon}</span>
      <span>{label}</span>
    </a>
  );
}

function EnhancementControls({
  generationStatus,
  hasTranscript,
  hasEnhancedSummary,
  error,
  onGenerate,
}: {
  generationStatus: GenerationStatus;
  hasTranscript: boolean;
  hasEnhancedSummary: boolean;
  error: string | null;
  onGenerate: () => void;
}) {
  const generating =
    generationStatus === "pending" || generationStatus === "streaming";

  if (generating) {
    return (
      <div className="mt-12 flex justify-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-border bg-bg-subtle px-4 py-2 text-sm font-semibold text-text shadow-lg shadow-black/20">
          <LoaderCircle className="h-4 w-4 animate-spin text-emerald-400" />
          Enhancing notes
        </span>
      </div>
    );
  }

  if (!hasTranscript) {
    return null;
  }

  return (
    <div className="mt-12 flex flex-col items-center gap-3">
      <Button
        variant="outline"
        onClick={onGenerate}
        className="rounded-full border-border-strong bg-bg-subtle px-5 text-text hover:bg-bg-elevated"
      >
        <Sparkles className="h-4 w-4 text-emerald-400" />
        {generationStatus === "failed"
          ? "Try again"
          : hasEnhancedSummary
            ? "Regenerate notes"
            : "Generate notes"}
      </Button>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}

function EnhancedMarkdown({ markdown }: { markdown: string }) {
  return (
    <article className="min-h-[46vh] text-[1rem] leading-8 text-text">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ node, ...props }) => (
            <h1
              className="mb-5 mt-10 text-3xl font-semibold leading-tight text-text first:mt-0"
              {...props}
            />
          ),
          h2: ({ node, ...props }) => (
            <h2 className="mb-3 mt-10 text-xl font-semibold leading-snug text-text first:mt-0" {...props} />
          ),
          h3: ({ node, ...props }) => (
            <h3 className="mb-2 mt-8 text-base font-semibold leading-snug text-text first:mt-0" {...props} />
          ),
          p: ({ node, ...props }) => (
            <p className="my-4 text-text-muted" {...props} />
          ),
          ul: ({ node, ...props }) => (
            <ul className="my-4 list-disc space-y-2 pl-5 text-text-muted marker:text-text-subtle" {...props} />
          ),
          ol: ({ node, ...props }) => (
            <ol className="my-4 list-decimal space-y-2 pl-5 text-text-muted marker:text-text-subtle" {...props} />
          ),
          li: ({ node, ...props }) => (
            <li className="pl-1" {...props} />
          ),
          strong: ({ node, ...props }) => (
            <strong className="font-semibold text-text" {...props} />
          ),
          em: ({ node, ...props }) => (
            <em className="text-text" {...props} />
          ),
          code: ({ node, ...props }) => (
            <code className="rounded bg-bg-elevated px-1 py-0.5 font-mono text-sm text-text" {...props} />
          ),
          blockquote: ({ node, ...props }) => (
            <blockquote className="my-5 border-l border-border-strong pl-4 text-text-muted" {...props} />
          ),
          hr: ({ node, ...props }) => (
            <hr className="my-8 border-border" {...props} />
          ),
          a: ({ node, ...props }) => (
            <a className="text-text underline decoration-border-strong underline-offset-4 hover:decoration-text-muted" {...props} />
          ),
          input: ({ node, ...props }) => (
            <input className="mr-2 align-middle accent-emerald-500" {...props} />
          ),
        }}
      >
        {markdown}
      </ReactMarkdown>
    </article>
  );
}

function formatAudioTime(value: number): string {
  const seconds = Math.max(0, Math.round(value));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function hasDraggedImage(event: DragEvent<HTMLElement>): boolean {
  const items = Array.from(event.dataTransfer.items);
  if (items.length > 0) {
    return items.some(
      (item) => item.kind === "file" && item.type.startsWith("image/")
    );
  }
  return Array.from(event.dataTransfer.files).some((file) =>
    file.type.startsWith("image/")
  );
}
