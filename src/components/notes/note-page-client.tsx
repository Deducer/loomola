"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Calendar,
  Check,
  ChevronUp,
  CircleAlert,
  FileText,
  Folder,
  MoreHorizontal,
  Pause,
  Play,
  RefreshCcw,
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
  people: TranscriptPerson[];
  speakerAssignments: TranscriptSpeakerAssignment[];
};

type SaveState = "idle" | "saving" | "saved" | "error";

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
    <div className="min-h-screen bg-bg pb-28 text-text">
      <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-4 py-5 sm:px-6 sm:py-8">
        <div className="flex items-center justify-between">
          <Link href="/" aria-label="Back to dashboard">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="flex items-center gap-2">
            <Badge variant={status}>{status}</Badge>
            <Button variant="ghost" size="icon" aria-label="More note actions">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <section className="mt-9">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={saveTitle}
            placeholder="New note"
            className={cn(
              "w-full border-none bg-transparent px-0 text-4xl font-semibold tracking-normal text-text outline-none placeholder:italic placeholder:text-text-subtle",
              !title.trim() && "italic text-text-subtle"
            )}
          />
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-text-muted">
            <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-bg-elevated px-3">
              <Calendar className="h-3.5 w-3.5" />
              {meetingDate}
            </span>
            <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-bg-elevated px-3">
              <Users className="h-3.5 w-3.5" />
              {attendeeLabel}
            </span>
            <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-bg-elevated px-3">
              <Folder className="h-3.5 w-3.5" />
              {folderLabel ?? "Add to folder"}
            </span>
            {durationLabel && (
              <span className="inline-flex h-8 items-center rounded-full bg-bg-elevated px-3">
                {durationLabel}
              </span>
            )}
            <SaveIndicator state={titleState} />
          </div>
        </section>

        <section className="mt-10 flex-1">
          <Textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Write notes"
            className="min-h-[42vh] resize-none border-0 bg-transparent px-0 py-0 text-base leading-8 shadow-none placeholder:text-text-subtle focus-visible:ring-0 focus-visible:ring-offset-0"
          />
          <div className="mt-4 flex items-center gap-2 text-xs text-text-subtle">
            <SaveIndicator state={saveState} />
          </div>
        </section>

        {transcriptOpen && (
          <section className="fixed inset-x-4 bottom-24 z-30 mx-auto max-w-3xl rounded-lg border border-border bg-bg-elevated p-3 shadow-2xl shadow-black/30">
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

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-bg/90 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <Button
            variant="secondary"
            size="icon"
            onClick={togglePlay}
            disabled={!audioUrl}
            aria-label={playing ? "Pause audio" : "Play audio"}
          >
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </Button>
          <button
            type="button"
            onClick={() => setTranscriptOpen((open) => !open)}
            className="flex min-w-0 flex-1 items-center gap-3 rounded-md border border-border bg-bg-subtle px-3 py-2 text-left transition-colors hover:bg-bg-elevated"
          >
            <Volume2 className="h-4 w-4 shrink-0 text-accent" />
            {waveformUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={waveformUrl}
                alt=""
                className="h-8 min-w-0 flex-1 rounded object-cover opacity-80"
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
