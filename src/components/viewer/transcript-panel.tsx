"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  groupWordsIntoParagraphs,
  findActiveParagraphIndex,
  type Word,
} from "@/lib/viewer/paragraphs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type TranscriptPerson = {
  id: string;
  displayName: string;
};

export type TranscriptSpeakerAssignment = {
  speakerIdx: number;
  personId: string | null;
  displayLabelOverride: string | null;
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
}: {
  mediaId?: string;
  words: Word[];
  fullText: string;
  currentTime: number;
  onSeek: (sec: number) => void;
  people?: TranscriptPerson[];
  speakerAssignments?: TranscriptSpeakerAssignment[];
  onSpeakerAssignmentsChange?: (assignments: TranscriptSpeakerAssignment[]) => void;
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

          return (
            <div key={i} className="relative">
              {showSpeaker && speakerLabel && (
                <div className="px-3 pb-1 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setOpenSpeaker(openSpeaker === speakerIdx ? null : speakerIdx);
                      setLabelDraft("");
                    }}
                    className="text-xs font-medium text-accent hover:text-text"
                  >
                    {speakerLabel}
                  </button>
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
                    ? "bg-accent/10 text-text"
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
