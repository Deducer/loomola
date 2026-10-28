import { randomUUID } from "node:crypto";
import {
  applyReconcilePlan,
  getNoteForSpeakerSuggestion,
  getPeopleForSuggestion,
  lockedAssignments,
  persistSpeakerSuggestions,
  saveSpeakerProfile,
  setActivityKey,
  setSpeakerLlmStatus,
  withSpeakerWriteLock,
} from "@/db/queries/speaker-suggestion";
import {
  composeSpeakerSuggestions,
  dismissedDerivationsOf,
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
  data: SuggestSpeakersJobData,
  opts: { signal?: AbortSignal } = {}
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
  const { transcriptId, transcriptCreatedAt, transcriptProvider } = note;
  if (note.words.length === 0 || !transcriptId || !transcriptCreatedAt || !transcriptProvider) {
    console.log(`[suggest-speakers] ${mediaObjectId} no transcript yet, skipping`);
    return;
  }

  const version = transcriptVersionOf(transcriptProvider, transcriptCreatedAt);
  const runId = randomUUID();
  // Throws when the capture tracks exist but can't be read — pg-boss
  // retries. Falling back to "no tracks" would re-enable talk-time
  // guessing on exactly the notes where the mic would have answered.
  const activity =
    transcriptProvider === "deepgram-live" ? null : await activityFor(mediaObjectId, note, opts.signal);
  const tracks =
    note.r2MicKey && note.r2SystemaudioKey ? "both" : note.r2MicKey || note.r2SystemaudioKey ? "partial" : "none";
  const profile = computeSpeakerProfile({ words: note.words, provider: transcriptProvider, activity, tracks });

  const people = await getPeopleForSuggestion(note.ownerId);
  const selfPerson = people.find((p) => p.isSelf) ?? null;

  // An expired job (pg-boss aborts it and schedules the retry) must not
  // keep writing alongside its own retry.
  throwIfAborted(opts.signal);

  // Reconcile + deterministic names, in one locked transaction against
  // the transcript this job profiled (see withSpeakerWriteLock).
  const first = await withSpeakerWriteLock({ mediaObjectId, transcriptId }, async ({ tx, rows, attendees: lockedAttendees }) => {
    const attendees = parseAttendees(lockedAttendees);
    const plan = reconcileAssignments({
      rows,
      currentVersion: version,
      currentTranscriptCreatedAt: transcriptCreatedAt,
      profile,
      selfPersonId: selfPerson?.id ?? null,
      attendeePersonIds: attendees
        .map((a) => a.personId)
        .filter((id): id is string => Boolean(id) && id !== selfPerson?.id),
    });
    if (plan.deleteIds.length + plan.remaps.length + plan.restampIds.length + plan.reviewIds.length > 0) {
      await applyReconcilePlan(tx, { mediaObjectId, version, plan });
      console.log(
        `[suggest-speakers] ${mediaObjectId} reconciled onto ${version}: ` +
          `deleted=${plan.deleteIds.length} moved=${plan.remaps.length} kept=${plan.restampIds.length} review=${plan.reviewIds.length}`
      );
    }
    const locked = await lockedAssignments(tx, mediaObjectId);
    const decided = decidedState(locked);
    const suggestions = selfPerson
      ? composeSpeakerSuggestions({
          words: note.words,
          profile,
          attendees,
          people,
          selfPersonId: selfPerson.id,
          skipIdxs: decided.idxs,
          takenPersonIds: decided.personIds,
          dismissedDerivations: dismissedDerivationsOf(locked),
        })
      : [];
    await persistSpeakerSuggestions(tx, { mediaObjectId, transcriptVersion: version, suggestions });
    // Stage 17 transcript-content attribution runs for participant voices
    // the deterministic rungs left unlabeled. Never on a live transcript:
    // its system channel is everyone else at once, so one name would be a
    // lie.
    const covered = new Set([...decided.idxs, ...suggestions.map((s) => s.speakerIdx)]);
    const uncovered = profile.entries
      .filter((e) => !e.fragment && !covered.has(e.speakerIdx))
      .map((e) => e.speakerIdx);
    const runLlm =
      Boolean(selfPerson) &&
      uncovered.length > 0 &&
      profile.entries.length >= 2 &&
      attendees.length > 0 &&
      profile.status !== "live_channels";
    // Last, so a stored profile means this transcript's rows are done —
    // except the LLM pass, whose status is "pending" until it finishes.
    await saveSpeakerProfile(tx, transcriptId, { ...profile, llm: runLlm ? "pending" : "skipped", runId });
    return { suggestions, decided, attendees, uncovered, runLlm, attendeesRaw: JSON.stringify(lockedAttendees ?? null) };
  });
  if (first.stale) {
    console.log(`[suggest-speakers] ${mediaObjectId} transcript replaced mid-job; writing nothing (its own job runs)`);
    return;
  }
  if (!selfPerson) {
    console.log(`[suggest-speakers] ${mediaObjectId} owner has no self-Person; reconciled only`);
    return;
  }
  logWritten(mediaObjectId, first.result.suggestions, profile.status);
  const { attendees, uncovered, runLlm } = first.result;
  if (!runLlm) return;

  // The LLM call runs outside the lock; its names are written under the
  // lock again with decisions and the attendee list re-checked.
  let llmSuggestions: SpeakerSuggestion[];
  try {
    llmSuggestions = await attributeViaTranscript({
      words: note.words,
      attendees,
      people,
      selfPerson,
      // When the mic already found Me (or the user placed the owner), the
      // LLM may not also name the recorder on another voice.
      allowSelf:
        meSpeakerIdxs(profile).length === 0 && !first.result.decided.personIds.has(selfPerson.id),
      uncoveredIdxs: uncovered,
      signal: opts.signal,
    });
  } catch (err) {
    throwIfAborted(opts.signal);
    // Best-effort: deterministic names are already written. Recorded so
    // the backfill treats the note as unfinished and re-runs it.
    console.error(`[suggest-speakers] ${mediaObjectId} LLM attribution failed:`, err);
    await setSpeakerLlmStatus(transcriptId, runId, "failed");
    return;
  }
  throwIfAborted(opts.signal);
  if (llmSuggestions.length === 0) {
    await setSpeakerLlmStatus(transcriptId, runId, "done");
    return;
  }
  const second = await withSpeakerWriteLock({ mediaObjectId, transcriptId }, async ({ tx, rows, attendees: nowAttendees }) => {
    // The LLM named people from the attendee list read under the first
    // lock; if the list changed since, its names may be the old ones —
    // and the run that the change enqueued owns the LLM status now.
    if (JSON.stringify(nowAttendees ?? null) !== first.result.attendeesRaw) return null;
    const decided = decidedState(rows);
    const fresh = llmSuggestions.filter(
      (s) => !decided.idxs.has(s.speakerIdx) && (!s.personId || !decided.personIds.has(s.personId))
    );
    await persistSpeakerSuggestions(tx, { mediaObjectId, transcriptVersion: version, suggestions: fresh });
    return fresh;
  });
  if (second.stale || second.result === null) return;
  await setSpeakerLlmStatus(transcriptId, runId, "done");
  console.log(
    `[suggest-speakers] ${mediaObjectId} LLM attributed ${second.result.length}/${uncovered.length} unlabeled speaker(s)`
  );
}

function throwIfAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) throw new Error("suggest_speakers aborted (job expired); its retry takes over");
}

function decidedState(rows: ReadonlyArray<{ speakerIdx: number; personId: string | null; dismissedAt: Date | null }>) {
  return {
    idxs: new Set(rows.map((r) => r.speakerIdx)),
    personIds: new Set(
      rows.filter((r) => r.personId && r.dismissedAt === null).map((r) => r.personId as string)
    ),
  };
}

function logWritten(mediaObjectId: string, suggestions: ReadonlyArray<SpeakerSuggestion>, status: string) {
  const auto = suggestions.filter((s) => s.autoApply).length;
  console.log(
    `[suggest-speakers] ${mediaObjectId} wrote ${auto} auto-applied name(s), ${suggestions.length - auto} suggestion(s) (profile=${status})`
  );
}

/** Loudness frames: from activity.bin when mix_audio wrote it, otherwise
 *  decoded once from the raw tracks (notes recorded before v2) and
 *  stored. Returns null only when the note has no capture tracks; any
 *  failure to read existing tracks THROWS so the job retries. */
async function activityFor(
  mediaObjectId: string,
  note: { r2MicKey: string | null; r2SystemaudioKey: string | null; r2ActivityKey: string | null },
  signal: AbortSignal | undefined
): Promise<ActivityFrames | null> {
  if (note.r2ActivityKey) {
    const frames = await loadActivity(note.r2ActivityKey, signal);
    if (frames) return frames;
  }
  if (!note.r2MicKey || !note.r2SystemaudioKey) return null;
  const frames = await computeActivityFromTrackKeys({
    micKey: note.r2MicKey,
    systemAudioKey: note.r2SystemaudioKey,
    signal,
    timeoutMs: ACTIVITY_DECODE_TIMEOUT_MS,
  });
  const key = activityKeyForTrack(note.r2MicKey);
  await uploadActivity(key, frames);
  await setActivityKey(mediaObjectId, key);
  return frames;
}

/** Hard cap on the fallback decode — well inside the job's 900 s expiry
 *  so a hung ffmpeg is killed before pg-boss retries the job. */
const ACTIVITY_DECODE_TIMEOUT_MS = 10 * 60 * 1000;

async function attributeViaTranscript(params: {
  words: ReadonlyArray<WordTimestamp>;
  attendees: ReadonlyArray<ParsedAttendee>;
  people: ReadonlyArray<PersonCandidate & { isSelf?: boolean }>;
  selfPerson: PersonCandidate;
  allowSelf: boolean;
  uncoveredIdxs: ReadonlyArray<number>;
  signal?: AbortSignal;
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
    abortSignal: params.signal,
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
