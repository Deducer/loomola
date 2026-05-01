"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowLeft,
  Calendar,
  Check,
  ChevronUp,
  CircleAlert,
  FileText,
  Folder,
  LoaderCircle,
  MoreHorizontal,
  Pause,
  Play,
  RefreshCcw,
  Sparkles,
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
  initialEnhancedSummary: string | null;
  initialGenerationStatus: GenerationStatus;
  people: TranscriptPerson[];
  speakerAssignments: TranscriptSpeakerAssignment[];
};

type SaveState = "idle" | "saving" | "saved" | "error";
type GenerationStatus = "idle" | "pending" | "streaming" | "complete" | "failed";
type NoteViewMode = "original" | "enhanced";

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
  initialEnhancedSummary,
  initialGenerationStatus,
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
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    return `${minutes}:${String(remainder).padStart(2, "0")}`;
  }, [durationSeconds]);
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
    <div className="min-h-screen bg-bg pb-32 text-text">
      <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col px-4 py-5 sm:px-6 sm:py-9">
        <div className="flex items-center justify-between text-text-subtle">
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
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full hover:bg-bg-subtle"
              aria-label="More note actions"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <section className="mt-10">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={saveTitle}
            placeholder="New note"
            className={cn(
              "w-full border-none bg-transparent px-0 text-[2.35rem] font-semibold leading-tight tracking-normal text-text outline-none placeholder:italic placeholder:text-text-subtle sm:text-[2.65rem]",
              !title.trim() && "italic text-text-subtle"
            )}
          />
          <div className="mt-5 flex flex-wrap items-center gap-2 text-sm text-text-muted">
            <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-bg-subtle px-3">
              <Calendar className="h-3.5 w-3.5" />
              {meetingDate}
            </span>
            <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-bg-subtle px-3">
              <Users className="h-3.5 w-3.5" />
              {attendeeLabel}
            </span>
            <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-bg-subtle px-3">
              <Folder className="h-3.5 w-3.5" />
              {folderLabel ?? "Add to folder"}
            </span>
            {durationLabel && (
              <span className="inline-flex h-8 items-center rounded-full bg-bg-subtle px-3">
                {durationLabel}
              </span>
            )}
            <SaveIndicator state={titleState} />
          </div>
        </section>

        <section className="mt-12 flex-1">
          {viewMode === "enhanced" && enhancedSummary ? (
            <EnhancedMarkdown markdown={enhancedSummary} />
          ) : (
            <Textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="Write notes"
              className="min-h-[42vh] resize-none border-0 bg-transparent px-0 py-0 text-base leading-8 shadow-none placeholder:text-text-subtle focus-visible:ring-0 focus-visible:ring-offset-0"
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
          <section className="fixed inset-x-4 bottom-28 z-30 mx-auto max-w-2xl rounded-lg border border-border bg-bg-elevated p-3 shadow-2xl shadow-black/30">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <FileText className="h-4 w-4 text-accent" />
                Transcript
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setTranscriptOpen(false)}
                aria-label="Collapse transcript"
              >
                <ChevronUp className="h-4 w-4" />
              </Button>
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
            />
          </section>
        )}
      </main>

      <div className="fixed inset-x-0 bottom-0 z-40 px-4 pb-4 pt-3">
        <div className="mx-auto flex max-w-2xl items-center gap-2 rounded-lg border border-border bg-bg-subtle/95 p-2 shadow-2xl shadow-black/30 backdrop-blur">
          <Button
            variant="secondary"
            size="icon"
            onClick={togglePlay}
            disabled={!audioUrl}
            className="h-10 w-10 shrink-0 rounded-md bg-bg-elevated hover:bg-border-strong"
            aria-label={playing ? "Pause audio" : "Play audio"}
          >
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </Button>
          <button
            type="button"
            onClick={() => setTranscriptOpen((open) => !open)}
            className="flex min-w-0 flex-1 items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-bg-elevated"
          >
            <Volume2 className="h-4 w-4 shrink-0 text-emerald-400" />
            {waveformUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={waveformUrl}
                alt=""
                className="h-8 min-w-0 flex-1 rounded object-cover opacity-90"
              />
            ) : (
              <span className="min-w-0 flex-1 text-sm text-text-muted">
                {status === "ready" ? "Waveform unavailable" : "Processing"}
              </span>
            )}
          </button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setTranscriptOpen((open) => !open)}
            className="h-9 w-9 shrink-0 rounded-md"
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
      <div className="mt-10 flex justify-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-300 shadow-lg shadow-black/20">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          Enhancing notes
        </span>
      </div>
    );
  }

  if (!hasTranscript) {
    return null;
  }

  if (hasEnhancedSummary && generationStatus !== "failed") {
    return null;
  }

  return (
    <div className="mt-10 flex flex-col items-center gap-3">
      <Button
        variant="outline"
        onClick={onGenerate}
        className="rounded-full border-emerald-500/30 bg-emerald-500/5 px-5 text-emerald-300 hover:bg-emerald-500/10"
      >
        <Sparkles className="h-4 w-4" />
        {generationStatus === "failed" ? "Try again" : "Generate notes"}
      </Button>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}

function EnhancedMarkdown({ markdown }: { markdown: string }) {
  return (
    <article className="min-h-[42vh] text-[0.97rem] leading-8 text-text">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ node, ...props }) => (
            <h1
              className="mb-5 mt-9 text-3xl font-semibold leading-tight text-text first:mt-0"
              {...props}
            />
          ),
          h2: ({ node, ...props }) => (
            <h2 className="mb-3 mt-9 text-xl font-semibold leading-snug text-text first:mt-0" {...props} />
          ),
          h3: ({ node, ...props }) => (
            <h3 className="mb-2 mt-7 text-base font-semibold leading-snug text-text first:mt-0" {...props} />
          ),
          p: ({ node, ...props }) => (
            <p className="my-4 text-text-muted" {...props} />
          ),
          ul: ({ node, ...props }) => (
            <ul className="my-4 list-disc space-y-2 pl-5 text-text-muted" {...props} />
          ),
          ol: ({ node, ...props }) => (
            <ol className="my-4 list-decimal space-y-2 pl-5 text-text-muted" {...props} />
          ),
          li: ({ node, ...props }) => (
            <li className="pl-1 marker:text-text-subtle" {...props} />
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
