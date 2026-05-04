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
  suggestedNewPersonPayload?: {
    displayName: string | null;
    email: string | null;
  } | null;
};

export function TranscriptPanel({
  mediaId,
  words,
  fullText,
  currentTime,
  onSeek,
  people = [],
  speakerAssignments = [],
  onSpeakerAssignmentsChange,
  tone = "accent",
}: {
  mediaId?: string;
  words: Word[];
  fullText: string;
  currentTime: number;
  onSeek: (sec: number) => void;
  people?: TranscriptPerson[];
  speakerAssignments?: TranscriptSpeakerAssignment[];
  onSpeakerAssignmentsChange?: (assignments: TranscriptSpeakerAssignment[]) => void;
  tone?: "accent" | "neutral";
}) {
  const paragraphs = useMemo(() => groupWordsIntoParagraphs(words), [words]);
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

  useEffect(() => {
    if (activeIdx < 0) return;
    const container = containerRef.current;
    const el = paragraphRefs.current[activeIdx];
    if (!container || !el) return;
    // Scroll only the transcript container — never the document. Element.scrollIntoView
    // walks every ancestor scroll container including <html>, which yanks the share
    // page away from the player every time the active paragraph changes.
    const containerRect = container.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    if (elRect.top >= containerRect.top && elRect.bottom <= containerRect.bottom) return;
    const targetTop = container.scrollTop + (elRect.top - containerRect.top);
    container.scrollTo({ top: targetTop, behavior: "smooth" });
  }, [activeIdx]);

  if (paragraphs.length === 0) {
    return (
      <p className="rounded-xl border border-border bg-bg-subtle/60 p-4 text-sm leading-7 text-text-muted">
        {fullText || "(empty transcript)"}
      </p>
    );
  }

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
        body: JSON.stringify({ speakerIdx, ...input }),
      });
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
          body: JSON.stringify(body),
        }
      );
      if (!response.ok) {
        if (response.status === 409) {
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
    if (!mediaId) return;
    setBusySpeaker(speakerIdx);
    try {
      const response = await fetch(
        `/api/recordings/${mediaId}/speaker-suggestions/dismiss`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ speakerIdx }),
        }
      );
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
    <div>
      <div
        ref={containerRef}
        className="max-h-96 overflow-y-auto rounded-xl border border-border bg-bg-subtle/60 p-2"
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
                      isSuggested && "italic"
                    )}
                  >
                    {speakerLabel}
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
                      <p className="text-xs font-semibold uppercase tracking-wider text-text-subtle">
                        Assign this speaker
                      </p>
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
              <button
                type="button"
                ref={(el) => {
                  paragraphRefs.current[i] = el;
                }}
                onClick={() => onSeek(p.startSec)}
                className={`block w-full rounded-md px-3 py-2 text-left text-sm leading-7 transition-colors ${
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
          );
        })}
      </div>
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
