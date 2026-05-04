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
 *   - self-detection inconclusive (top two speakers within 5%)
 *
 * The caller persists each returned suggestion as a row in
 * speaker_assignments with is_suggestion = true.
 */
export function composeSpeakerSuggestions(args: {
  words: ReadonlyArray<WordTimestamp>;
  attendees: ReadonlyArray<ParsedAttendee>;
  people: ReadonlyArray<PersonCandidate>;
  selfPersonId: string | null;
}): SpeakerSuggestion[] {
  const { words, attendees, people, selfPersonId } = args;

  if (!selfPersonId) return [];
  if (attendees.length === 0) return [];

  // Distinct speaker_idx values that actually have speech.
  const speakerSet = new Set<number>();
  for (const w of words) {
    if (typeof w.speaker === "number") speakerSet.add(w.speaker);
  }
  const speakers = Array.from(speakerSet).sort((a, b) => a - b);
  if (speakers.length < 2) return [];

  // Path B's strict-only rule: attendees + 1 (you) must equal speaker count.
  if (attendees.length !== speakers.length - 1) return [];

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
    const matched = matchPerson({ candidates: people, attendee });
    if (matched.confidence === "none") {
      // Suggest creating a new Person from the attendee's data.
      result.push({
        speakerIdx,
        personId: null,
        confidence: "medium",
        reason: "new_person_from_attendee",
        suggestedNewPerson: {
          displayName: attendee.displayName,
          email: attendee.email,
        },
      });
    } else {
      result.push({
        speakerIdx,
        personId: matched.personId,
        confidence: matched.confidence,
        reason: matched.reason,
      });
    }
  }

  return result;
}
