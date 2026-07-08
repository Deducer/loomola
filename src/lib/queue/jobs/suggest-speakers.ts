import {
  getNoteForSpeakerSuggestion,
  getPeopleForSuggestion,
  hasExistingSpeakerAssignments,
  persistSpeakerSuggestions,
} from "@/db/queries/speaker-suggestion";
import {
  composeSpeakerSuggestions,
  type SpeakerSuggestion,
} from "@/lib/speaker-suggestion/compose";
import {
  parseAttendees,
  type ParsedAttendee,
} from "@/lib/speaker-suggestion/parse-attendees";
import {
  buildAttributionPrompt,
  buildAttributionTranscript,
  buildSpeakerUtterances,
  speakerAttributionSchema,
  verifyAttributions,
} from "@/lib/speaker-suggestion/attribute-llm";
import {
  matchPerson,
  type PersonCandidate,
} from "@/lib/speaker-suggestion/match-person";
import { generateObjectWithFallback } from "@/lib/ai/with-fallback";
import type { WordTimestamp } from "@/db/queries/transcripts";

export const SUGGEST_SPEAKERS_JOB = "suggest_speakers";

export type SuggestSpeakersJobData = { mediaObjectId: string };

/**
 * Auto-suggests speaker_idx → person mappings for a recording using the
 * meeting context's attendees + the user's existing people library. Only
 * runs when the schema is well-defined (Path B):
 *   - transcript exists with diarized words
 *   - user has marked one Person as is_self = true
 *   - meeting has attendees on the row
 *   - speaker count == attendee count + 1 (covers 1:1 and 3-person calls)
 *
 * On any other shape (3 speakers but only 1 attendee, no self-Person,
 * etc.), no-ops with a single log line. Path C will pick up the cases B
 * leaves on the floor by using voice biometrics.
 */
export async function runSuggestSpeakersJob(
  data: SuggestSpeakersJobData
): Promise<void> {
  const { mediaObjectId } = data;

  const note = await getNoteForSpeakerSuggestion(mediaObjectId);
  if (!note) {
    console.log(
      `[suggest-speakers] ${mediaObjectId} not found, skipping`
    );
    return;
  }

  // v1 (Path B) is audio-only because the speaker-assignment UI only
  // exists for audio notes today. Video recordings get the same flow
  // when video gets a creator-side transcript labeling surface.
  if (note.type !== "audio") {
    console.log(
      `[suggest-speakers] ${mediaObjectId} is type=${note.type}; v1 is audio-only, skipping`
    );
    return;
  }

  if (note.words.length === 0) {
    console.log(
      `[suggest-speakers] ${mediaObjectId} no transcript yet, skipping`
    );
    return;
  }

  if (await hasExistingSpeakerAssignments(mediaObjectId)) {
    console.log(
      `[suggest-speakers] ${mediaObjectId} already has speaker_assignments rows; skipping`
    );
    return;
  }

  const attendees = parseAttendees(note.attendees);
  if (attendees.length === 0) {
    console.log(
      `[suggest-speakers] ${mediaObjectId} no attendees, skipping`
    );
    return;
  }

  const people = await getPeopleForSuggestion(note.ownerId);
  const selfPerson = people.find((p) => p.isSelf);
  if (!selfPerson) {
    console.log(
      `[suggest-speakers] ${mediaObjectId} owner has no self-Person, skipping`
    );
    return;
  }

  let suggestions = composeSpeakerSuggestions({
    words: note.words,
    attendees,
    people,
    selfPersonId: selfPerson.id,
    sourceSeparated: note.sourceSeparated,
  });

  // Stage 17: transcript-content attribution for whatever the
  // deterministic paths left unlabeled. People address each other by
  // name; an LLM pass can map voices with actual evidence, gated by
  // verifyAttributions so an unverifiable mapping is dropped rather
  // than guessed — those speakers fall back to the manual picker.
  const speakerIdxs = distinctSpeakerIdxs(note.words);
  const covered = new Set(suggestions.map((s) => s.speakerIdx));
  const uncovered = speakerIdxs.filter((idx) => !covered.has(idx));
  if (uncovered.length > 0 && speakerIdxs.length >= 2) {
    try {
      const llmSuggestions = await attributeViaTranscript({
        words: note.words,
        attendees,
        people,
        selfPerson,
        uncoveredIdxs: uncovered,
      });
      suggestions = [...suggestions, ...llmSuggestions];
      console.log(
        `[suggest-speakers] ${mediaObjectId} LLM attributed ${llmSuggestions.length}/${uncovered.length} unlabeled speaker(s)`
      );
    } catch (err) {
      // Best-effort: deterministic suggestions still persist.
      console.error(
        `[suggest-speakers] ${mediaObjectId} LLM attribution failed:`,
        err
      );
    }
  }

  if (suggestions.length === 0) {
    console.log(
      `[suggest-speakers] ${mediaObjectId} no evidence-backed suggestions, skipping`
    );
    return;
  }

  await persistSpeakerSuggestions({
    mediaObjectId,
    suggestions,
  });

  console.log(
    `[suggest-speakers] ${mediaObjectId} persisted ${suggestions.length} suggestion(s)`
  );
}

function distinctSpeakerIdxs(words: ReadonlyArray<WordTimestamp>): number[] {
  const set = new Set<number>();
  for (const w of words) {
    if (typeof w.speaker === "number") set.add(w.speaker);
  }
  return Array.from(set).sort((a, b) => a - b);
}

async function attributeViaTranscript(params: {
  words: ReadonlyArray<WordTimestamp>;
  attendees: ReadonlyArray<ParsedAttendee>;
  people: ReadonlyArray<PersonCandidate & { isSelf?: boolean }>;
  selfPerson: PersonCandidate;
  uncoveredIdxs: ReadonlyArray<number>;
}): Promise<SpeakerSuggestion[]> {
  const peopleById = new Map(params.people.map((p) => [p.id, p]));
  // Resolve attendee display names (attendees are stored as person
  // UUIDs since Stage 11; legacy rows may carry names directly).
  const attendeesByName = new Map<string, ParsedAttendee>();
  for (const attendee of params.attendees) {
    const name =
      attendee.displayName ??
      (attendee.personId ? peopleById.get(attendee.personId)?.displayName : null);
    if (name && !attendeesByName.has(name)) {
      attendeesByName.set(name, attendee);
    }
  }
  if (attendeesByName.size === 0) return [];

  const utterances = buildSpeakerUtterances(params.words);
  const attendeeNames = Array.from(attendeesByName.keys());
  const transcript = buildAttributionTranscript({
    utterances,
    attendeeNames: [...attendeeNames, params.selfPerson.displayName],
  });

  const { object } = await generateObjectWithFallback({
    schema: speakerAttributionSchema,
    schemaName: "SpeakerAttribution",
    prompt: buildAttributionPrompt({
      attendeeNames,
      selfName: params.selfPerson.displayName,
      speakerIdxs: params.uncoveredIdxs,
      transcript,
    }),
  });

  const verified = verifyAttributions({
    raw: object.attributions,
    attendeeNames: [...attendeeNames, params.selfPerson.displayName],
    speakerIdxs: params.uncoveredIdxs,
    transcriptText: utterances.map((u) => u.text).join("\n"),
  });

  return verified.map((attribution) => {
    if (attribution.attendeeName === params.selfPerson.displayName) {
      return {
        speakerIdx: attribution.speakerIdx,
        personId: params.selfPerson.id,
        confidence: "high" as const,
        reason: "llm_transcript_evidence",
        evidence: attribution.evidence,
      };
    }
    const attendee = attendeesByName.get(attribution.attendeeName);
    const matched = attendee
      ? matchPerson({ candidates: params.people, attendee })
      : null;
    if (matched && matched.confidence !== "none" && matched.personId) {
      return {
        speakerIdx: attribution.speakerIdx,
        personId: matched.personId,
        confidence: "high" as const,
        reason: "llm_transcript_evidence",
        evidence: attribution.evidence,
      };
    }
    return {
      speakerIdx: attribution.speakerIdx,
      personId: null,
      confidence: "medium" as const,
      reason: "llm_transcript_evidence_new_person",
      evidence: attribution.evidence,
      suggestedNewPerson: {
        displayName: attendee?.displayName ?? attribution.attendeeName,
        email: attendee?.email ?? null,
      },
    };
  });
}
