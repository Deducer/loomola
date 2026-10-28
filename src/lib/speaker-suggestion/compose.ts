import type { WordTimestamp } from "@/db/queries/transcripts";
import { detectSelfSpeakerIdx } from "./detect-self";
import type { ParsedAttendee } from "./parse-attendees";
import {
  matchPerson,
  type MatchConfidence,
  type PersonCandidate,
} from "./match-person";
import {
  meSpeakerIdxs,
  mergedMeSpeakerIdx,
  soleRemoteSpeakerIdx,
  type SpeakerProfile,
} from "@/lib/speaker-profile/profile";

export interface SpeakerSuggestion {
  speakerIdx: number;
  personId: string | null;
  confidence: MatchConfidence;
  /** Derivation, persisted as speaker_assignments.suggestion_confidence. */
  reason: string;
  /** Capture evidence (mic track / sole remote voice on a 1:1) applies
   *  without a click, Granola-style; everything inferred stays a
   *  suggestion the user confirms. */
  autoApply: boolean;
  /** Written as a visibly uncertain suggestion the user must check
   *  (two mic-dominant voices: one person split by diarization, or two
   *  people sharing a microphone — loudness can't tell which). */
  needsReview?: boolean;
  /** Verbatim transcript quote justifying an LLM attribution (Stage 17). */
  evidence?: string;
  /** When set, the caller should create a new Person row from this data
   *  before applying the speaker_assignment. */
  suggestedNewPerson?: {
    displayName: string | null;
    email: string | null;
  };
}

/** Fallback-only talk-time margin: with no capture tracks, "the
 *  recorder talked most" is trusted only when it's overwhelming. */
const DOMINANT_FALLBACK_MARGIN = 0.5;

/**
 * Speaker recognition v2 evidence ladder (deterministic rungs; the
 * worker runs the LLM evidence pass afterwards for what's left):
 *
 *   1. Me = the voice(s) the capture evidence ties to the mic track
 *      (live transcripts: channel 0). Auto-applied.
 *   2. Exactly one remote voice and exactly one remote attendee (a
 *      1:1) → that attendee. Auto-applied when the attendee is an
 *      existing Person, otherwise a create-person suggestion.
 *   3. No capture tracks at all: talk-time self detection, only for
 *      1:1-or-smaller calls with an overwhelming margin. Suggestion.
 *
 * v1's positional mapping (attendee #1 = voice #1) is gone: for 3+
 * people it was a guess, and the design law is never misattribute.
 * `skipIdxs` are voices that already carry a decision; `takenPersonIds`
 * are people already assigned to some voice.
 */
export function composeSpeakerSuggestions(args: {
  words: ReadonlyArray<WordTimestamp>;
  profile: SpeakerProfile;
  attendees: ReadonlyArray<ParsedAttendee>;
  people: ReadonlyArray<PersonCandidate>;
  selfPersonId: string | null;
  skipIdxs?: ReadonlySet<number>;
  takenPersonIds?: ReadonlySet<string>;
  /** Derivations of names the user dismissed on this note. */
  dismissedDerivations?: ReadonlySet<string>;
}): SpeakerSuggestion[] {
  const { profile, people, selfPersonId } = args;
  if (!selfPersonId) return [];
  const skip = args.skipIdxs ?? new Set<number>();
  const taken = args.takenPersonIds ?? new Set<string>();
  const attendees = args.attendees.filter((a) => a.personId !== selfPersonId);
  const result: SpeakerSuggestion[] = [];
  const dismissed = args.dismissedDerivations ?? new Set<string>();
  // The user said "Not <name>" to an automatic Me / remote name on this
  // note: keep offering the evidence, but never re-apply it without a click.
  const selfDismissed = [...dismissed].some((d) => d.startsWith("self_via_"));
  const remoteDismissed = dismissed.has("remote_via_single_voice");

  // One mic-dominant voice is the recorder. Two are either the recorder
  // split by diarization or two people on one microphone; loudness can't
  // tell which, so both become uncertain suggestions — never two "Me"
  // names applied without a click.
  const me = meSpeakerIdxs(profile);
  const sharedMic = me.length > 1;
  // The low-gain rule is weaker evidence than a clearly mic-only voice.
  const lowGain = profile.entries.some((e) => me.includes(e.speakerIdx) && e.lowGain);
  for (const idx of me) {
    // A user who already put the owner on some voice has decided.
    if (skip.has(idx) || taken.has(selfPersonId)) continue;
    result.push({
      speakerIdx: idx,
      personId: selfPersonId,
      confidence: sharedMic ? "medium" : "high",
      reason:
        profile.status === "live_channels"
          ? "self_via_source_channel"
          : sharedMic
            ? "self_via_mic_capture_shared"
            : "self_via_mic_capture",
      autoApply: !sharedMic && !selfDismissed && !lowGain,
      ...(sharedMic ? { needsReview: true } : {}),
    });
  }

  // Diarization merged the recorder with someone else into one voice:
  // offer "Me?" for the user to check; never apply it.
  const mergedIdx = me.length === 0 ? mergedMeSpeakerIdx(profile) : null;
  if (mergedIdx !== null && !skip.has(mergedIdx) && !taken.has(selfPersonId)) {
    result.push({
      speakerIdx: mergedIdx,
      personId: selfPersonId,
      confidence: "medium",
      reason: "self_via_mic_capture_merged",
      autoApply: false,
      needsReview: true,
    });
  }

  const soleRemote = soleRemoteSpeakerIdx(profile);
  if (me.length > 0 && soleRemote !== null && attendees.length === 1 && !skip.has(soleRemote)) {
    const s = suggestionForAttendee({ speakerIdx: soleRemote, attendee: attendees[0], people });
    if (!s.personId || !taken.has(s.personId)) {
      // On a LIVE transcript the remote "voice" is the whole system-audio
      // channel; an uninvited extra participant would be inside it, so the
      // live name stays a suggestion (the batch transcript decides).
      result.push({
        ...s,
        reason: "remote_via_single_voice",
        autoApply: s.personId !== null && !remoteDismissed && !lowGain && profile.status !== "live_channels",
      });
    }
  }

  // Talk time only means anything on a genuine two-voice call.
  const participantVoices = profile.entries.filter((e) => !e.fragment).length;
  if (profile.status === "no_tracks" && attendees.length <= 1 && participantVoices === 2 && !taken.has(selfPersonId)) {
    const idx = detectSelfSpeakerIdx(args.words, DOMINANT_FALLBACK_MARGIN);
    const entry = profile.entries.find((e) => e.speakerIdx === idx);
    if (idx !== null && entry && !entry.fragment && !skip.has(idx) && profile.entries.length >= 2) {
      result.push({
        speakerIdx: idx,
        personId: selfPersonId,
        confidence: "high",
        reason: "self_via_dominant_speech",
        autoApply: false,
      });
    }
  }

  return result;
}

function suggestionForAttendee(args: {
  speakerIdx: number;
  attendee: ParsedAttendee;
  people: ReadonlyArray<PersonCandidate>;
}): Omit<SpeakerSuggestion, "autoApply"> {
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

/** Derivations of names the user dismissed on this note ("Not <name>").
 *  A dismissal survives transcript replacement even when its voice can't
 *  be mapped, and stops that kind of name being re-applied without a
 *  click. Shared by the worker and the backfill dry run. */
export function dismissedDerivationsOf(
  rows: ReadonlyArray<{ dismissedAt: Date | null; suggestionConfidence: string | null }>
): Set<string> {
  return new Set(
    rows
      .filter((r) => r.dismissedAt !== null && r.suggestionConfidence)
      // "Not Ian" on an evidence-confirmed pre-v2 row blocks that kind of name too.
      .map((r) => (r.suggestionConfidence as string).replace(/^legacy:/, ""))
  );
}
