"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import { toast } from "sonner";
import {
  groupWordsIntoParagraphs,
  findActiveParagraphIndex,
  type Word,
} from "@/lib/viewer/paragraphs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";

export type TranscriptPerson = {
  id: string;
  displayName: string;
};

export type TranscriptSpeakerAssignment = {
  speakerIdx: number;
  personId: string | null;
  displayLabelOverride: string | null;
  isSuggestion?: boolean;
  /** Speaker v2: named from capture evidence without a click; undoable. */
  autoApplied?: boolean;
  /** Speaker v2: a confirmed name the new transcript couldn't vouch for. */
  needsReview?: boolean;
  suggestionConfidence?: string | null;
  suggestedNewPersonPayload?: {
    displayName: string | null;
    email: string | null;
  } | null;
};

/** How long a manual scroll of the transcript pauses auto-follow. */
export const AUTO_FOLLOW_PAUSE_MS = 4000;

export function autoFollowPaused(lastUserScrollAt: number, now: number): boolean {
  return now - lastUserScrollAt < AUTO_FOLLOW_PAUSE_MS;
}

export function formatTranscriptTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = (total % 60).toString().padStart(2, "0");
  return h > 0 ? `${h}:${m.toString().padStart(2, "0")}:${s}` : `${m}:${s}`;
}

export function TranscriptPanel({
  mediaId,
  words,
  wordsEndpoint,
  fullText,
  currentTime,
  onSeek,
  people = [],
  speakerAssignments = [],
  onSpeakerAssignmentsChange,
  tone = "accent",
  transcriptVersion,
  showTimestamps = false,
  fillHeightOnXl = false,
}: {
  mediaId?: string;
  words: Word[];
  /** When set (and `words` is empty), the word-timing array is fetched from
   * this URL only once the panel scrolls into view, instead of being shipped
   * in the server render. Until it loads, `fullText` renders as a plain block.
   * A viewer who never scrolls to the transcript never pulls the (often very
   * large) wordTimestamps blob out of Postgres — a Supabase egress saving on
   * the public share page. Callers that pass `words` directly are unchanged. */
  wordsEndpoint?: string;
  fullText: string;
  currentTime: number;
  onSeek: (sec: number) => void;
  people?: TranscriptPerson[];
  speakerAssignments?: TranscriptSpeakerAssignment[];
  onSpeakerAssignmentsChange?: (assignments: TranscriptSpeakerAssignment[]) => void;
  tone?: "accent" | "neutral";
  /** Version of the transcript being shown; sent with label writes so the
   *  server refuses a label made against a transcript that was replaced. */
  transcriptVersion?: string | null;
  /** Render a clickable mm:ss button before each paragraph. */
  showTimestamps?: boolean;
  /** At the xl breakpoint, drop the card chrome and fill the parent's
   *  height (the share page's sticky side panel) instead of max-h-96. */
  fillHeightOnXl?: boolean;
}) {
  const [fetchedWords, setFetchedWords] = useState<Word[] | null>(null);
  const outerRef = useRef<HTMLDivElement | null>(null);
  const paragraphs = useMemo(
    () => groupWordsIntoParagraphs(wordsEndpoint ? fetchedWords ?? [] : words),
    [wordsEndpoint, fetchedWords, words]
  );
  const activeIdx = useMemo(
    () => findActiveParagraphIndex(paragraphs, currentTime),
    [paragraphs, currentTime]
  );
  const peopleById = useMemo(
    () => new Map(people.map((person) => [person.id, person])),
    [people]
  );
  const assignmentBySpeaker = useMemo(
    () =>
      new Map(speakerAssignments.map((assignment) => [assignment.speakerIdx, assignment])),
    [speakerAssignments]
  );

  const containerRef = useRef<HTMLDivElement | null>(null);
  const paragraphRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [openSpeaker, setOpenSpeaker] = useState<number | null>(null);
  const [labelDraft, setLabelDraft] = useState("");
  const [busySpeaker, setBusySpeaker] = useState<number | null>(null);

  // Auto-follow: keep the active paragraph in view as playback moves, but
  // back off for a few seconds after the viewer scrolls the panel themselves.
  // Our own smooth scrolls also fire `scroll` events, so those are ignored
  // until `programmaticScrollUntil` passes.
  const lastUserScrollAt = useRef(0);
  const programmaticScrollUntil = useRef(0);
  const hasParagraphs = paragraphs.length > 0;
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onScroll = () => {
      const now = Date.now();
      if (now > programmaticScrollUntil.current) lastUserScrollAt.current = now;
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, [hasParagraphs]);

  useEffect(() => {
    if (activeIdx < 0) return;
    const container = containerRef.current;
    const el = paragraphRefs.current[activeIdx];
    if (!container || !el) return;
    const now = Date.now();
    if (autoFollowPaused(lastUserScrollAt.current, now)) return;
    // Scroll only the transcript container — never the document. Element.scrollIntoView
    // walks every ancestor scroll container including <html>, which yanks the share
    // page away from the player every time the active paragraph changes.
    const containerRect = container.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    if (elRect.top >= containerRect.top && elRect.bottom <= containerRect.bottom) return;
    // Land the active paragraph a third of the way down so the next lines show.
    const targetTop =
      container.scrollTop + (elRect.top - containerRect.top) - container.clientHeight / 3;
    programmaticScrollUntil.current = now + 1000;
    container.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
    // currentTime is a dependency so following resumes once the pause
    // window ends, even if the active paragraph hasn't changed since.
  }, [activeIdx, currentTime]);

  // Lazy word fetch: only fires when the panel enters the viewport.
  useEffect(() => {
    if (!wordsEndpoint || fetchedWords !== null) return;
    let cancelled = false;
    const loadWords = async () => {
      try {
        const res = await fetch(wordsEndpoint);
        const data: { words?: unknown } = res.ok ? await res.json() : {};
        if (!cancelled) {
          setFetchedWords(Array.isArray(data.words) ? (data.words as Word[]) : []);
        }
      } catch {
        if (!cancelled) setFetchedWords([]);
      }
    };
    const el = outerRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      void loadWords();
      return () => {
        cancelled = true;
      };
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          io.disconnect();
          void loadWords();
        }
      },
      { rootMargin: "200px" }
    );
    io.observe(el);
    return () => {
      cancelled = true;
      io.disconnect();
    };
  }, [wordsEndpoint, fetchedWords]);

  async function assignSpeaker(speakerIdx: number, input: {
    personId?: string | null;
    displayLabelOverride?: string | null;
  }) {
    if (!mediaId) return;
    setBusySpeaker(speakerIdx);
    try {
      const response = await fetch(`/api/speaker-assignments/${mediaId}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ speakerIdx, ...input, transcriptVersion: transcriptVersion ?? null }),
      });
      if (response.status === 409) {
        toast.error("The transcript was just updated — reload the page to label speakers.");
        return;
      }
      if (!response.ok) throw new Error("speaker_assignment_failed");
      const row = (await response.json()) as TranscriptSpeakerAssignment;
      const next = [
        ...speakerAssignments.filter((item) => item.speakerIdx !== speakerIdx),
        row,
      ];
      onSpeakerAssignmentsChange?.(next);
      setOpenSpeaker(null);
      setLabelDraft("");
    } finally {
      setBusySpeaker(null);
    }
  }

  async function acceptSuggestion(
    assignment: TranscriptSpeakerAssignment,
    speakerLabel: string
  ) {
    if (!mediaId) return;
    setBusySpeaker(assignment.speakerIdx);
    try {
      const body = assignment.personId
        ? { speakerIdx: assignment.speakerIdx, personId: assignment.personId }
        : {
            speakerIdx: assignment.speakerIdx,
            createPerson: {
              displayName:
                assignment.suggestedNewPersonPayload?.displayName ??
                assignment.displayLabelOverride ??
                speakerLabel,
              email: assignment.suggestedNewPersonPayload?.email ?? null,
            },
          };
      const response = await fetch(
        `/api/recordings/${mediaId}/speaker-suggestions/accept`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...body, transcriptVersion: transcriptVersion ?? null }),
        }
      );
      if (!response.ok) {
        if (response.status === 409) {
          const payload = (await response.json().catch(() => null)) as { error?: string } | null;
          if (payload?.error === "transcript_changed") {
            toast.error("The transcript was just updated — reload the page to label speakers.");
            return;
          }
          // Already cleared by another tab — silent.
          onSpeakerAssignmentsChange?.(
            speakerAssignments.filter(
              (item) => item.speakerIdx !== assignment.speakerIdx
            )
          );
          return;
        }
        throw new Error(`accept_failed_${response.status}`);
      }
      const result = (await response.json()) as { personId: string };
      // Update local: clear the suggestion flag, set the personId.
      const next = speakerAssignments.map((item) =>
        item.speakerIdx === assignment.speakerIdx
          ? {
              ...item,
              personId: result.personId,
              displayLabelOverride: null,
              isSuggestion: false,
              suggestedNewPersonPayload: null,
            }
          : item
      );
      onSpeakerAssignmentsChange?.(next);
      toast.success(`Labeled Speaker ${assignment.speakerIdx + 1} as ${speakerLabel}`);
    } catch (err) {
      console.error("[transcript-panel] accept suggestion failed:", err);
      toast.error("Couldn't apply the suggestion. Try again.");
    } finally {
      setBusySpeaker(null);
    }
  }

  async function dismissSuggestion(speakerIdx: number) {
    const shownPersonId = assignmentBySpeaker.get(speakerIdx)?.personId ?? null;
    if (!mediaId) return;
    setBusySpeaker(speakerIdx);
    try {
      const response = await fetch(
        `/api/recordings/${mediaId}/speaker-suggestions/dismiss`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ speakerIdx, personId: shownPersonId, transcriptVersion: transcriptVersion ?? null }),
        }
      );
      if (response.status === 409) {
        toast.error("The transcript was just updated — reload the page to label speakers.");
        return;
      }
      if (!response.ok) throw new Error(`dismiss_failed_${response.status}`);
      onSpeakerAssignmentsChange?.(
        speakerAssignments.filter((item) => item.speakerIdx !== speakerIdx)
      );
    } catch (err) {
      console.error("[transcript-panel] dismiss suggestion failed:", err);
    } finally {
      setBusySpeaker(null);
    }
  }

  return (
    <div ref={outerRef} className={cn(fillHeightOnXl && "xl:h-full")}>
      {paragraphs.length === 0 ? (
        <p
          className={cn(
            "rounded-xl border border-border bg-bg-subtle/60 p-4 text-sm leading-7 text-text-muted",
            fillHeightOnXl && "xl:rounded-none xl:border-0 xl:bg-transparent"
          )}
        >
          {fullText || "(empty transcript)"}
        </p>
      ) : (
      <div
        ref={containerRef}
        className={cn(
          "max-h-96 overflow-y-auto rounded-xl border border-border bg-bg-subtle/60 p-2",
          fillHeightOnXl &&
            "xl:h-full xl:max-h-none xl:rounded-none xl:border-0 xl:bg-transparent"
        )}
      >
        {paragraphs.map((p, i) => {
          const speakerIdx =
            typeof p.speaker === "number" ? p.speaker : null;
          const showSpeaker =
            speakerIdx !== null &&
            (i === 0 || paragraphs[i - 1].speaker !== speakerIdx);
          const speakerLabel =
            speakerIdx !== null
              ? labelForSpeaker(speakerIdx, assignmentBySpeaker, peopleById)
              : null;

          const assignment =
            speakerIdx !== null ? assignmentBySpeaker.get(speakerIdx) : undefined;
          const isSuggested = Boolean(assignment?.isSuggestion);
          // A name the evidence couldn't vouch for must look uncertain in
          // the transcript itself, not only on hover.
          const needsReview = Boolean(assignment?.needsReview);

          return (
            <div key={i} className="relative">
              {showSpeaker && speakerLabel && (
                <div className="flex items-center gap-2 px-3 pb-1 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setOpenSpeaker(openSpeaker === speakerIdx ? null : speakerIdx);
                      setLabelDraft("");
                    }}
                    className={cn(
                      "text-xs font-medium hover:text-text",
                      tone === "neutral" ? "text-text-muted" : "text-accent",
                      isSuggested && "italic",
                      needsReview && "text-amber-500 underline decoration-dashed underline-offset-2"
                    )}
                    title={speakerProvenance(assignment)}
                    data-needs-review={needsReview || undefined}
                  >
                    {speakerLabel}
                    {needsReview && (
                      <span className="ml-1 text-[10px] uppercase tracking-wider">
                        check?
                      </span>
                    )}
                    {isSuggested && (
                      <span className="ml-1 text-[10px] uppercase tracking-wider text-text-subtle">
                        suggested
                      </span>
                    )}
                  </button>
                  {isSuggested && assignment && speakerIdx !== null && (
                    <span className="inline-flex items-center gap-0.5">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void acceptSuggestion(assignment, speakerLabel);
                        }}
                        disabled={busySpeaker === speakerIdx}
                        className="flex h-5 w-5 items-center justify-center rounded-full text-emerald-400 transition-colors hover:bg-emerald-500/15 disabled:opacity-50"
                        aria-label={`Confirm Speaker ${speakerIdx + 1} as ${speakerLabel}`}
                        title={`Confirm as ${speakerLabel}`}
                      >
                        <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void dismissSuggestion(speakerIdx);
                        }}
                        disabled={busySpeaker === speakerIdx}
                        className="flex h-5 w-5 items-center justify-center rounded-full text-text-subtle transition-colors hover:bg-bg-subtle hover:text-red-400 disabled:opacity-50"
                        aria-label="Dismiss suggestion"
                        title="Dismiss"
                      >
                        <X className="h-3.5 w-3.5" strokeWidth={2.5} />
                      </button>
                    </span>
                  )}
                  {openSpeaker === speakerIdx && speakerIdx !== null && (
                    <div className="mt-2 w-full rounded-lg border border-border bg-bg-elevated p-3 shadow-lg">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold uppercase tracking-wider text-text-subtle">
                          Assign this speaker
                        </p>
                        {assignment && (assignment.autoApplied || assignment.needsReview) && (
                          <button
                            type="button"
                            onClick={() => {
                              setOpenSpeaker(null);
                              void dismissSuggestion(speakerIdx);
                            }}
                            disabled={busySpeaker === speakerIdx}
                            className="text-xs text-text-subtle hover:text-red-400 disabled:opacity-50"
                          >
                            Not {speakerLabel}
                          </button>
                        )}
                      </div>
                      {assignment?.needsReview && (
                        <p className="mt-1 text-xs text-text-subtle">
                          The final transcript re-numbered the voices — check this name.
                        </p>
                      )}
                      {people.length > 0 && (
                        <div className="mt-2 max-h-36 overflow-y-auto">
                          {people.map((person) => (
                            <button
                              key={person.id}
                              type="button"
                              onClick={() =>
                                assignSpeaker(speakerIdx, {
                                  personId: person.id,
                                  displayLabelOverride: null,
                                })
                              }
                              disabled={busySpeaker === p.speaker}
                              className="block w-full rounded px-2 py-1.5 text-left text-sm text-text-muted hover:bg-bg-subtle hover:text-text"
                            >
                              {person.displayName}
                            </button>
                          ))}
                        </div>
                      )}
                      <div className="mt-3 flex gap-2">
                        <Input
                          value={labelDraft}
                          onChange={(event) => setLabelDraft(event.target.value)}
                          placeholder="One-off label"
                          className="h-8 text-sm"
                        />
                        <Button
                          size="sm"
                          onClick={() =>
                            assignSpeaker(speakerIdx, {
                              personId: null,
                              displayLabelOverride: labelDraft,
                            })
                          }
                          disabled={busySpeaker === p.speaker || !labelDraft.trim()}
                        >
                          Label
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              <div className="flex items-start gap-1">
                {showTimestamps && (
                  <button
                    type="button"
                    onClick={() => onSeek(p.startSec)}
                    aria-label={`Play from ${formatTranscriptTimestamp(p.startSec)}`}
                    className={cn(
                      "mt-2 shrink-0 rounded px-1.5 py-0.5 font-mono text-[11px] tabular-nums transition-colors",
                      i === activeIdx
                        ? "bg-accent/15 text-accent"
                        : "text-text-subtle hover:bg-bg-elevated hover:text-accent"
                    )}
                  >
                    {formatTranscriptTimestamp(p.startSec)}
                  </button>
                )}
                <button
                  type="button"
                  ref={(el) => {
                    paragraphRefs.current[i] = el;
                  }}
                  onClick={() => onSeek(p.startSec)}
                  aria-current={i === activeIdx ? "true" : undefined}
                  className={`block w-full min-w-0 rounded-md px-3 py-2 text-left text-sm leading-7 transition-colors ${
                    i === activeIdx
                      ? tone === "neutral"
                        ? "bg-bg-elevated text-text"
                        : "bg-accent/10 text-text"
                      : "text-text-muted hover:bg-bg-elevated hover:text-text"
                  }`}
                >
                  {p.text}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      )}
    </div>
  );
}

function labelForSpeaker(
  speakerIdx: number,
  assignments: Map<number, TranscriptSpeakerAssignment>,
  people: Map<string, TranscriptPerson>
) {
  const assignment = assignments.get(speakerIdx);
  if (assignment?.displayLabelOverride) return assignment.displayLabelOverride;
  if (assignment?.personId) {
    return people.get(assignment.personId)?.displayName ?? `Speaker ${speakerIdx + 1}`;
  }
  return `Speaker ${speakerIdx + 1}`;
}

function speakerProvenance(assignment: TranscriptSpeakerAssignment | undefined): string | undefined {
  if (!assignment) return undefined;
  if (assignment.needsReview) return "Check this name — the final transcript re-numbered the voices";
  if (!assignment.autoApplied) return undefined;
  if (
    assignment.suggestionConfidence === "self_via_mic_capture" ||
    assignment.suggestionConfidence === "self_via_source_channel"
  ) {
    return "Named from your microphone — click to change";
  }
  if (assignment.suggestionConfidence === "remote_via_single_voice") {
    return "Named from the calendar invite (the only other voice) — click to change";
  }
  return "Named automatically — click to change";
}
