import {
  applyReconcilePlan,
  getNoteForSpeakerSuggestion,
  getPeopleForSuggestion,
  listAssignmentsForReconcile,
  persistSpeakerSuggestions,
  saveSpeakerProfile,
  setActivityKey,
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
import {
  computeSpeakerProfile,
  meSpeakerIdxs,
} from "@/lib/speaker-profile/profile";
import type { ActivityFrames } from "@/lib/speaker-profile/activity";
import {
  reconcileAssignments,
  transcriptVersionOf,
} from "@/lib/speaker-profile/reconcile";
import {
  computeActivityFromTrackKeys,
  loadActivity,
  uploadActivity,
} from "@/lib/speaker-profile/track-activity";
import { activityKeyForTrack } from "@/lib/recording/audio-artifacts";

export const SUGGEST_SPEAKERS_JOB = "suggest_speakers";

export type SuggestSpeakersJobData = { mediaObjectId: string };

/**
 * Speaker recognition v2 (spec 2026-10-27). Runs whenever an audio
 * note's transcript is written (live or batch), after note generation,
 * and after the attendee list changes:
 *
 *   1. Profile the current transcript's voices from the capture tracks
 *      (mic vs system loudness) and store it on the transcript row.
 *   2. Reconcile existing rows onto this transcript version — the live
 *      transcript indexes voices by channel and the batch one by
 *      diarization, so rows from an older transcript are deleted,
 *      confirmed, moved, or flagged for review (user decisions are never
 *      silently rewritten).
 *   3. For voices without a decision: the evidence ladder (Me from the
 *      mic; the sole remote voice on a 1:1), then the Stage-17 LLM
 *      verbatim-evidence pass for named attendees. Capture evidence is
 *      auto-applied; inferred names stay suggestions.
 */
export async function runSuggestSpeakersJob(
  data: SuggestSpeakersJobData
): Promise<void> {
  const { mediaObjectId } = data;

  const note = await getNoteForSpeakerSuggestion(mediaObjectId);
  if (!note) {
    console.log(`[suggest-speakers] ${mediaObjectId} not found, skipping`);
    return;
  }
  // Audio-only: the speaker-labeling UI only exists for audio notes.
  if (note.type !== "audio") {
    console.log(`[suggest-speakers] ${mediaObjectId} is type=${note.type}; audio-only, skipping`);
    return;
  }
  if (note.words.length === 0 || !note.transcriptId || !note.transcriptCreatedAt || !note.transcriptProvider) {
    console.log(`[suggest-speakers] ${mediaObjectId} no transcript yet, skipping`);
    return;
  }

  const version = transcriptVersionOf(note.transcriptProvider, note.transcriptCreatedAt);
  const activity =
    note.transcriptProvider === "deepgram-live" ? null : await activityFor(mediaObjectId, note);
  const profile = computeSpeakerProfile({
    words: note.words,
    provider: note.transcriptProvider,
    activity,
  });
  await saveSpeakerProfile(note.transcriptId, profile);

  const people = await getPeopleForSuggestion(note.ownerId);
  const selfPerson = people.find((p) => p.isSelf) ?? null;

  const existing = await listAssignmentsForReconcile(mediaObjectId);
  const plan = reconcileAssignments({
    rows: existing,
    currentVersion: version,
    currentTranscriptCreatedAt: note.transcriptCreatedAt,
    profile,
    selfPersonId: selfPerson?.id ?? null,
  });
  if (plan.deleteIds.length + plan.remaps.length + plan.restampIds.length + plan.reviewIds.length > 0) {
    await applyReconcilePlan({ mediaObjectId, version, plan });
    console.log(
      `[suggest-speakers] ${mediaObjectId} reconciled onto ${version}: ` +
        `deleted=${plan.deleteIds.length} moved=${plan.remaps.length} kept=${plan.restampIds.length} review=${plan.reviewIds.length}`
    );
  }

  if (!selfPerson) {
    console.log(`[suggest-speakers] ${mediaObjectId} owner has no self-Person, skipping`);
    return;
  }

  const current = await listAssignmentsForReconcile(mediaObjectId);
  const decidedIdxs = new Set(current.map((r) => r.speakerIdx));
  const takenPersonIds = new Set(
    current.filter((r) => r.personId && r.dismissedAt === null).map((r) => r.personId as string)
  );
  const attendees = parseAttendees(note.attendees);

  let suggestions = composeSpeakerSuggestions({
    words: note.words,
    profile,
    attendees,
    people,
    selfPersonId: selfPerson.id,
    skipIdxs: decidedIdxs,
    takenPersonIds,
  });

  // Stage 17 transcript-content attribution for participant voices the
  // deterministic rungs left unlabeled. Never on a live transcript: its
  // system channel is everyone else at once, so one name would be a lie.
  const covered = new Set([...decidedIdxs, ...suggestions.map((s) => s.speakerIdx)]);
  const uncovered = profile.entries
    .filter((e) => !e.fragment && !covered.has(e.speakerIdx))
    .map((e) => e.speakerIdx);
  const meFound = meSpeakerIdxs(profile).length > 0;
  if (
    uncovered.length > 0 &&
    profile.entries.length >= 2 &&
    attendees.length > 0 &&
    profile.status !== "live_channels"
  ) {
    try {
      const llmSuggestions = await attributeViaTranscript({
        words: note.words,
        attendees,
        people,
        selfPerson,
        // When the mic already found Me, the LLM may not also name the
        // recorder — that would put the owner on a second voice.
        allowSelf: !meFound && !takenPersonIds.has(selfPerson.id),
        uncoveredIdxs: uncovered,
      });
      const filtered = llmSuggestions.filter(
        (s) => !s.personId || !takenPersonIds.has(s.personId)
      );
      suggestions = [...suggestions, ...filtered];
      console.log(
        `[suggest-speakers] ${mediaObjectId} LLM attributed ${filtered.length}/${uncovered.length} unlabeled speaker(s)`
      );
    } catch (err) {
      // Best-effort: deterministic suggestions still persist.
      console.error(`[suggest-speakers] ${mediaObjectId} LLM attribution failed:`, err);
    }
  }

  if (suggestions.length === 0) {
    console.log(
      `[suggest-speakers] ${mediaObjectId} no new evidence-backed names (profile=${profile.status})`
    );
    return;
  }

  await persistSpeakerSuggestions({ mediaObjectId, transcriptVersion: version, suggestions });
  const auto = suggestions.filter((s) => s.autoApply).length;
  console.log(
    `[suggest-speakers] ${mediaObjectId} wrote ${auto} auto-applied name(s), ${suggestions.length - auto} suggestion(s) (profile=${profile.status})`
  );
}

/** Loudness frames for the note: from activity.bin when mix_audio wrote
 *  it, otherwise computed once from the raw tracks and stored. Missing
 *  tracks or any failure → null (the profile degrades to no_tracks). */
async function activityFor(
  mediaObjectId: string,
  note: { r2MicKey: string | null; r2SystemaudioKey: string | null; r2ActivityKey: string | null }
): Promise<ActivityFrames | null> {
  try {
    if (note.r2ActivityKey) {
      const frames = await loadActivity(note.r2ActivityKey);
      if (frames) return frames;
    }
    if (!note.r2MicKey || !note.r2SystemaudioKey) return null;
    const frames = await computeActivityFromTrackKeys({
      micKey: note.r2MicKey,
      systemAudioKey: note.r2SystemaudioKey,
    });
    const key = activityKeyForTrack(note.r2MicKey);
    await uploadActivity(key, frames);
    await setActivityKey(mediaObjectId, key);
    return frames;
  } catch (err) {
    console.error(`[suggest-speakers] ${mediaObjectId} activity frames unavailable:`, err);
    return null;
  }
}

async function attributeViaTranscript(params: {
  words: ReadonlyArray<WordTimestamp>;
  attendees: ReadonlyArray<ParsedAttendee>;
  people: ReadonlyArray<PersonCandidate & { isSelf?: boolean }>;
  selfPerson: PersonCandidate;
  allowSelf: boolean;
  uncoveredIdxs: ReadonlyArray<number>;
}): Promise<SpeakerSuggestion[]> {
  const peopleById = new Map(params.people.map((p) => [p.id, p]));
  // Resolve attendee display names (attendees are stored as person
  // UUIDs since Stage 11; legacy rows may carry names directly).
  const attendeesByName = new Map<string, ParsedAttendee>();
  for (const attendee of params.attendees) {
    if (attendee.personId === params.selfPerson.id) continue;
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
    attendeeNames: params.allowSelf
      ? [...attendeeNames, params.selfPerson.displayName]
      : attendeeNames,
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
        autoApply: false,
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
        autoApply: false,
        evidence: attribution.evidence,
      };
    }
    return {
      speakerIdx: attribution.speakerIdx,
      personId: null,
      confidence: "medium" as const,
      reason: "llm_transcript_evidence_new_person",
      autoApply: false,
      evidence: attribution.evidence,
      suggestedNewPerson: {
        displayName: attendee?.displayName ?? attribution.attendeeName,
        email: attendee?.email ?? null,
      },
    };
  });
}
