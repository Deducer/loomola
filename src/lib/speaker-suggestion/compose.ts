import type { WordTimestamp } from "@/db/queries/transcripts";
import { detectSelfSpeakerIdx } from "./detect-self";
import type { ParsedAttendee } from "./parse-attendees";
import {
  matchPerson,
  type MatchConfidence,
  type PersonCandidate,
} from "./match-person";

export interface SpeakerSuggestion {
  speakerIdx: number;
  personId: string | null;
  confidence: MatchConfidence;
  reason: string;
  /** Verbatim transcript quote justifying an LLM attribution (Stage 17). */
  evidence?: string;
  /** When set, the caller should create a new Person row from this data
   *  before applying the speaker_assignment. */
  suggestedNewPerson?: {
    displayName: string | null;
    email: string | null;
  };
}

/**
 * Composes the full set of speaker→person suggestions for a recording.
 * Pure function: feeds straight from worker queries into the
 * speaker_assignments insert. Returns [] in any case where Path B can't
 * confidently produce suggestions:
 *
 *   - no self-Person set
 *   - no attendees in the meeting context
 *   - fewer than 2 distinct speakers detected
 *   - attendee count != speaker count - 1 (Path B doesn't guess when
 *     numbers don't line up — voice biometrics in Path C will)
 *   - self-detection inconclusive (top two speakers within 5%), unless
 *     the transcript came from Loomola's source-separated mic/system
 *     channels and the meeting is a simple 1:1
 *
 * The caller persists each returned suggestion as a row in
 * speaker_assignments with is_suggestion = true.
 */
export function composeSpeakerSuggestions(args: {
  words: ReadonlyArray<WordTimestamp>;
  attendees: ReadonlyArray<ParsedAttendee>;
  people: ReadonlyArray<PersonCandidate>;
  selfPersonId: string | null;
  sourceSeparated?: boolean;
}): SpeakerSuggestion[] {
  const { words, attendees, people, selfPersonId, sourceSeparated } = args;

  if (!selfPersonId) return [];
  if (attendees.length === 0) return [];

  // Distinct speaker_idx values that actually have speech.
  const speakerSet = new Set<number>();
  for (const w of words) {
    if (typeof w.speaker === "number") speakerSet.add(w.speaker);
  }
  const speakers = Array.from(speakerSet).sort((a, b) => a - b);
  if (speakers.length < 2) return [];

  // Path B's strict rule: attendees + 1 (you) must equal speaker count
  // for FULL mapping. When numbers don't line up (a no-show, an extra
  // voice), positional mapping would be a guess — but self-detection is
  // still evidence-based (dominant speech share), so label just the
  // user and leave the rest for manual assignment (Stage 16 relaxation).
  if (attendees.length !== speakers.length - 1) {
    const selfOnlyIdx = detectSelfSpeakerIdx(words);
    if (selfOnlyIdx === null || !speakers.includes(selfOnlyIdx)) return [];
    return [
      {
        speakerIdx: selfOnlyIdx,
        personId: selfPersonId,
        confidence: "high",
        reason: "self_via_dominant_speech",
      },
    ];
  }

  if (
    sourceSeparated &&
    attendees.length === 1 &&
    speakers.length === 2 &&
    speakers[0] === 0 &&
    speakers[1] === 1
  ) {
    const attendeeSuggestion = suggestionForAttendee({
      speakerIdx: 1,
      attendee: attendees[0],
      people,
    });
    return [
      {
        speakerIdx: 0,
        personId: selfPersonId,
        confidence: "high",
        reason: "self_via_source_channel",
      },
      attendeeSuggestion,
    ];
  }

  const selfIdx = detectSelfSpeakerIdx(words);
  if (selfIdx === null) return [];
  if (!speakers.includes(selfIdx)) return [];

  const result: SpeakerSuggestion[] = [];

  // Self speaker first.
  result.push({
    speakerIdx: selfIdx,
    personId: selfPersonId,
    confidence: "high",
    reason: "self_via_dominant_speech",
  });

  // Map remaining speakers to attendees in attendee order.
  const otherSpeakers = speakers.filter((s) => s !== selfIdx);
  for (let i = 0; i < otherSpeakers.length; i++) {
    const speakerIdx = otherSpeakers[i];
    const attendee = attendees[i];
    result.push(suggestionForAttendee({ speakerIdx, attendee, people }));
  }

  return result;
}

function suggestionForAttendee(args: {
  speakerIdx: number;
  attendee: ParsedAttendee;
  people: ReadonlyArray<PersonCandidate>;
}): SpeakerSuggestion {
  const matched = matchPerson({
    candidates: args.people,
    attendee: args.attendee,
  });
  if (matched.confidence === "none") {
    return {
      speakerIdx: args.speakerIdx,
      personId: null,
      confidence: "medium",
      reason: "new_person_from_attendee",
      suggestedNewPerson: {
        displayName: args.attendee.displayName,
        email: args.attendee.email,
      },
    };
  }
  return {
    speakerIdx: args.speakerIdx,
    personId: matched.personId,
    confidence: matched.confidence,
    reason: matched.reason,
  };
}
