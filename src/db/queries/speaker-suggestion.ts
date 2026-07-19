import { db } from "@/db";
import {
  mediaObjects,
  people,
  speakerAssignments,
  transcripts,
} from "@/db/schema";
import { and, eq } from "drizzle-orm";
import type { WordTimestamp } from "@/db/queries/transcripts";
import type { PersonCandidate } from "@/lib/speaker-suggestion/match-person";
import type { SpeakerSuggestion } from "@/lib/speaker-suggestion/compose";

export interface NoteForSpeakerSuggestion {
  ownerId: string;
  type: "video" | "audio";
  attendees: unknown;
  sourceSeparated: boolean;
  words: WordTimestamp[];
}

/** Loads what suggest_speakers needs to decide whether to run + what to
 *  feed the classifier. Returns null when the recording is missing or has
 *  no transcript yet. */
export async function getNoteForSpeakerSuggestion(
  mediaObjectId: string
): Promise<NoteForSpeakerSuggestion | null> {
  const [row] = await db
    .select({
      ownerId: mediaObjects.ownerId,
      type: mediaObjects.type,
      attendees: mediaObjects.attendees,
      r2MixedKey: mediaObjects.r2MixedKey,
      provider: transcripts.provider,
      words: transcripts.wordTimestamps,
    })
    .from(mediaObjects)
    .leftJoin(transcripts, eq(transcripts.mediaObjectId, mediaObjects.id))
    .where(eq(mediaObjects.id, mediaObjectId))
    .limit(1);

  if (!row) return null;

  const words = Array.isArray(row.words)
    ? (row.words as WordTimestamp[])
    : [];

  return {
    ownerId: row.ownerId,
    type: row.type,
    attendees: row.attendees,
    // Only live transcripts still carry channel-derived speaker labels
    // (0=mic/self, 1=system). Batch transcripts moved to mono+diarize
    // (2026-07-02), where indices are diarization order — the channel
    // fast-path in compose.ts must not fire for them.
    sourceSeparated: row.provider === "deepgram-live",
    words,
  };
}

export interface PersonForSuggestion extends PersonCandidate {
  isSelf: boolean;
}

/** Returns all of the user's people, including the is_self flag. */
export async function getPeopleForSuggestion(
  ownerId: string
): Promise<PersonForSuggestion[]> {
  const rows = await db
    .select({
      id: people.id,
      displayName: people.displayName,
      email: people.email,
      isSelf: people.isSelf,
    })
    .from(people)
    .where(eq(people.ownerId, ownerId));
  return rows.map((r) => ({
    id: r.id,
    displayName: r.displayName,
    email: r.email,
    isSelf: r.isSelf,
  }));
}

/** Returns true when there's already at least one speaker_assignments row
 *  for this recording (auto-suggested OR manual). Used by the worker to
 *  short-circuit when a previous run has already placed suggestions or
 *  when the user has already labeled manually. */
export async function hasExistingSpeakerAssignments(
  mediaObjectId: string
): Promise<boolean> {
  const [row] = await db
    .select({ id: speakerAssignments.id })
    .from(speakerAssignments)
    .where(eq(speakerAssignments.mediaObjectId, mediaObjectId))
    .limit(1);
  return row !== undefined;
}

/** Persists a batch of speaker suggestions. Idempotent: ON CONFLICT on
 *  (media_object_id, speaker_idx) does nothing — protects against
 *  re-runs of the worker. */
export async function persistSpeakerSuggestions(args: {
  mediaObjectId: string;
  suggestions: ReadonlyArray<SpeakerSuggestion>;
}): Promise<void> {
  if (args.suggestions.length === 0) return;
  const now = new Date();
  const rows = args.suggestions.map((s) => ({
    mediaObjectId: args.mediaObjectId,
    speakerIdx: s.speakerIdx,
    personId: s.personId,
    displayLabelOverride:
      s.suggestedNewPerson?.displayName ?? null,
    isSuggestion: true,
    suggestedAt: now,
    suggestedNewPersonPayload: s.suggestedNewPerson
      ? { displayName: s.suggestedNewPerson.displayName, email: s.suggestedNewPerson.email }
      : null,
    suggestionConfidence: s.reason,
    suggestionEvidence: s.evidence ?? null,
  }));

  await db
    .insert(speakerAssignments)
    .values(rows)
    .onConflictDoNothing({
      target: [
        speakerAssignments.mediaObjectId,
        speakerAssignments.speakerIdx,
      ],
    });
}

/** Deletes suggestion rows that are still pending (never accepted, never
 *  dismissed) so a re-run of the worker can recompute them. Used when the
 *  attendee list changes — stale pending suggestions from a wrong event
 *  would otherwise block the worker's existing-assignments gate forever.
 *  Accepted and dismissed rows are user decisions and stay untouched. */
export async function clearPendingSpeakerSuggestions(
  mediaObjectId: string
): Promise<void> {
  await db
    .delete(speakerAssignments)
    .where(
      and(
        eq(speakerAssignments.mediaObjectId, mediaObjectId),
        eq(speakerAssignments.isSuggestion, true)
      )
    );
}

/** Used by the API to apply an accepted suggestion: flip is_suggestion
 *  to false, optionally set person_id (when accepting a "create new
 *  person" suggestion the API does the INSERT into people first). */
export async function applySpeakerSuggestion(args: {
  mediaObjectId: string;
  ownerId: string;
  speakerIdx: number;
  personId: string;
  displayLabelOverride?: string | null;
}): Promise<{ ok: boolean }> {
  const result = await db
    .update(speakerAssignments)
    .set({
      personId: args.personId,
      displayLabelOverride: args.displayLabelOverride ?? null,
      isSuggestion: false,
      suggestedNewPersonPayload: null,
    })
    .from(mediaObjects)
    .where(
      and(
        eq(speakerAssignments.mediaObjectId, args.mediaObjectId),
        eq(speakerAssignments.speakerIdx, args.speakerIdx),
        eq(mediaObjects.id, speakerAssignments.mediaObjectId),
        eq(mediaObjects.ownerId, args.ownerId),
        eq(speakerAssignments.isSuggestion, true)
      )
    )
    .returning({ id: speakerAssignments.id });
  return { ok: result.length > 0 };
}

/** Used by the API to dismiss a pending suggestion. Deletes the row +
 *  inserts a marker row with dismissed_at set, so the worker can detect
 *  the dismissal and suppress re-suggesting. Idempotent. */
export async function dismissSpeakerSuggestion(args: {
  mediaObjectId: string;
  ownerId: string;
  speakerIdx: number;
}): Promise<{ ok: boolean }> {
  const result = await db
    .update(speakerAssignments)
    .set({
      isSuggestion: false,
      personId: null,
      displayLabelOverride: null,
      suggestedNewPersonPayload: null,
      dismissedAt: new Date(),
    })
    .from(mediaObjects)
    .where(
      and(
        eq(speakerAssignments.mediaObjectId, args.mediaObjectId),
        eq(speakerAssignments.speakerIdx, args.speakerIdx),
        eq(mediaObjects.id, speakerAssignments.mediaObjectId),
        eq(mediaObjects.ownerId, args.ownerId),
        eq(speakerAssignments.isSuggestion, true)
      )
    )
    .returning({ id: speakerAssignments.id });
  return { ok: result.length > 0 };
}
