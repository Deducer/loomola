import { db } from "@/db";
import {
  mediaObjects,
  people,
  speakerAssignments,
  transcripts,
} from "@/db/schema";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import type { WordTimestamp } from "@/db/queries/transcripts";
import type { PersonCandidate } from "@/lib/speaker-suggestion/match-person";
import type { SpeakerSuggestion } from "@/lib/speaker-suggestion/compose";
import type { SpeakerProfile } from "@/lib/speaker-profile/profile";
import type { ReconcilePlan, ReconcileRow } from "@/lib/speaker-profile/reconcile";

export interface NoteForSpeakerSuggestion {
  ownerId: string;
  type: "video" | "audio";
  attendees: unknown;
  words: WordTimestamp[];
  transcriptId: string | null;
  transcriptProvider: string | null;
  transcriptCreatedAt: Date | null;
  r2MicKey: string | null;
  r2SystemaudioKey: string | null;
  r2ActivityKey: string | null;
}

/** Loads what suggest_speakers needs: the latest transcript (words +
 *  which version it is) and the capture-track keys behind its speaker
 *  profile. Returns null when the recording is missing. */
export async function getNoteForSpeakerSuggestion(
  mediaObjectId: string
): Promise<NoteForSpeakerSuggestion | null> {
  const [row] = await db
    .select({
      ownerId: mediaObjects.ownerId,
      type: mediaObjects.type,
      attendees: mediaObjects.attendees,
      r2MicKey: mediaObjects.r2MicKey,
      r2SystemaudioKey: mediaObjects.r2SystemaudioKey,
      r2ActivityKey: mediaObjects.r2ActivityKey,
      transcriptId: transcripts.id,
      provider: transcripts.provider,
      transcriptCreatedAt: transcripts.createdAt,
      words: transcripts.wordTimestamps,
    })
    .from(mediaObjects)
    .leftJoin(transcripts, eq(transcripts.mediaObjectId, mediaObjects.id))
    .where(eq(mediaObjects.id, mediaObjectId))
    .orderBy(desc(transcripts.createdAt))
    .limit(1);

  if (!row) return null;

  return {
    ownerId: row.ownerId,
    type: row.type,
    attendees: row.attendees,
    words: Array.isArray(row.words) ? (row.words as WordTimestamp[]) : [],
    transcriptId: row.transcriptId,
    transcriptProvider: row.provider,
    transcriptCreatedAt: row.transcriptCreatedAt,
    r2MicKey: row.r2MicKey,
    r2SystemaudioKey: row.r2SystemaudioKey,
    r2ActivityKey: row.r2ActivityKey,
  };
}

export async function setActivityKey(mediaObjectId: string, key: string): Promise<void> {
  await db.update(mediaObjects).set({ r2ActivityKey: key }).where(eq(mediaObjects.id, mediaObjectId));
}

/** Stores the profile on the exact transcript row it was computed from.
 *  Written inside `withSpeakerWriteLock`, after the names, so a stored
 *  profile also means "this transcript's speaker rows are reconciled" —
 *  the backfill's completion marker. */
export async function saveSpeakerProfile(
  tx: SpeakerWriteTx,
  transcriptId: string,
  profile: SpeakerProfile
): Promise<void> {
  await tx.update(transcripts).set({ speakerProfile: profile }).where(eq(transcripts.id, transcriptId));
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

export type SpeakerWriteTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type LockedAssignmentRow = ReconcileRow & { suggestionConfidence: string | null };

/**
 * Runs `fn` with the note's speaker rows locked and the transcript the
 * job computed on still current — the only safe moment to reconcile or
 * write names:
 *
 *  - the media_objects row is locked FOR UPDATE, serializing concurrent
 *    suggest_speakers runs and attendee changes for this note;
 *  - the latest transcript is read FOR SHARE: if it isn't `transcriptId`
 *    the job computed against a transcript that has been replaced, so it
 *    writes nothing (the newer transcript's own job will run) — and while
 *    we hold the share lock a replacement can't delete it underneath us;
 *  - speaker rows are read FOR UPDATE, so a user's accept/edit that is in
 *    flight finishes first and the plan is computed from what they chose.
 *
 * Bounded lock wait: a stuck lock fails the job (pg-boss retries) rather
 * than hanging the worker.
 */
export async function withSpeakerWriteLock<T>(
  args: { mediaObjectId: string; transcriptId: string },
  fn: (ctx: { tx: SpeakerWriteTx; rows: LockedAssignmentRow[]; attendees: unknown }) => Promise<T>
): Promise<{ stale: true } | { stale: false; result: T }> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL lock_timeout = '10s'`);
    // The attendee list is read HERE, under the row lock: names derived
    // from attendees must come from the list that is current when they're
    // written (an attendee edit commits with this same row lock).
    const [media] = await tx
      .select({ id: mediaObjects.id, attendees: mediaObjects.attendees })
      .from(mediaObjects)
      .where(eq(mediaObjects.id, args.mediaObjectId))
      .for("update");
    if (!media) return { stale: true as const };
    const [current] = await tx
      .select({ id: transcripts.id })
      .from(transcripts)
      .where(eq(transcripts.mediaObjectId, args.mediaObjectId))
      .orderBy(desc(transcripts.createdAt))
      .limit(1)
      .for("share");
    if (!current || current.id !== args.transcriptId) return { stale: true as const };
    const rows = await lockedAssignments(tx, args.mediaObjectId);
    return { stale: false as const, result: await fn({ tx, rows, attendees: media.attendees }) };
  });
}

export async function lockedAssignments(
  tx: SpeakerWriteTx,
  mediaObjectId: string
): Promise<LockedAssignmentRow[]> {
  return tx
    .select({
      id: speakerAssignments.id,
      speakerIdx: speakerAssignments.speakerIdx,
      personId: speakerAssignments.personId,
      isSuggestion: speakerAssignments.isSuggestion,
      autoApplied: speakerAssignments.autoApplied,
      dismissedAt: speakerAssignments.dismissedAt,
      needsReview: speakerAssignments.needsReview,
      transcriptVersion: speakerAssignments.transcriptVersion,
      createdAt: speakerAssignments.createdAt,
      suggestedAt: speakerAssignments.suggestedAt,
      suggestionConfidence: speakerAssignments.suggestionConfidence,
    })
    .from(speakerAssignments)
    .where(eq(speakerAssignments.mediaObjectId, mediaObjectId))
    .for("update");
}

/** Applies a reconcile plan inside `withSpeakerWriteLock`. Deletes first
 *  (they free indices), then remaps through a temporary negative index
 *  because a remap can swap two rows (the swapped-1:1 case) and the
 *  (media_object_id, speaker_idx) index is unique. */
export async function applyReconcilePlan(
  tx: SpeakerWriteTx,
  args: { mediaObjectId: string; version: string; plan: ReconcilePlan }
): Promise<void> {
  const { plan, version } = args;
  const scoped = (id: string) =>
    and(eq(speakerAssignments.id, id), eq(speakerAssignments.mediaObjectId, args.mediaObjectId));
  if (plan.deleteIds.length > 0) {
    await tx
      .delete(speakerAssignments)
      .where(
        and(
          eq(speakerAssignments.mediaObjectId, args.mediaObjectId),
          inArray(speakerAssignments.id, plan.deleteIds)
        )
      );
  }
  for (const [i, remap] of plan.remaps.entries()) {
    await tx.update(speakerAssignments).set({ speakerIdx: -1 - i }).where(scoped(remap.id));
  }
  for (const remap of plan.remaps) {
    await tx
      .update(speakerAssignments)
      .set({ speakerIdx: remap.newIdx, transcriptVersion: version })
      .where(scoped(remap.id));
  }
  for (const id of plan.restampIds) {
    await tx.update(speakerAssignments).set({ transcriptVersion: version }).where(scoped(id));
  }
  for (const id of plan.reviewIds) {
    await tx
      .update(speakerAssignments)
      .set({ transcriptVersion: version, needsReview: true })
      .where(scoped(id));
  }
}

/** Persists speaker suggestions inside `withSpeakerWriteLock`.
 *  ON CONFLICT on (media_object_id, speaker_idx) does nothing, so a row
 *  that appeared meanwhile (a user's label) always wins. */
export async function persistSpeakerSuggestions(
  tx: SpeakerWriteTx,
  args: {
    mediaObjectId: string;
    transcriptVersion: string;
    suggestions: ReadonlyArray<SpeakerSuggestion>;
  }
): Promise<void> {
  if (args.suggestions.length === 0) return;
  const now = new Date();
  const rows = args.suggestions.map((s) => ({
    mediaObjectId: args.mediaObjectId,
    speakerIdx: s.speakerIdx,
    personId: s.personId,
    displayLabelOverride:
      s.suggestedNewPerson?.displayName ?? null,
    // Capture evidence applies without a click (undoable via dismiss);
    // everything inferred waits for the user.
    isSuggestion: !s.autoApply,
    autoApplied: s.autoApply,
    needsReview: s.needsReview ?? false,
    transcriptVersion: args.transcriptVersion,
    suggestedAt: now,
    suggestedNewPersonPayload: s.suggestedNewPerson
      ? { displayName: s.suggestedNewPerson.displayName, email: s.suggestedNewPerson.email }
      : null,
    suggestionConfidence: s.reason,
    suggestionEvidence: s.evidence ?? null,
  }));

  await tx
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
        or(
          eq(speakerAssignments.isSuggestion, true),
          // Auto-applied names that came FROM the attendee list are as
          // stale as pending ones once it changes; mic-derived Me rows
          // don't depend on attendees and stay.
          and(
            eq(speakerAssignments.autoApplied, true),
            eq(speakerAssignments.suggestionConfidence, "remote_via_single_voice")
          )
        )
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
      autoApplied: false,
      needsReview: false,
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
      autoApplied: false,
      needsReview: false,
      dismissedAt: new Date(),
    })
    .from(mediaObjects)
    .where(
      and(
        eq(speakerAssignments.mediaObjectId, args.mediaObjectId),
        eq(speakerAssignments.speakerIdx, args.speakerIdx),
        eq(mediaObjects.id, speakerAssignments.mediaObjectId),
        eq(mediaObjects.ownerId, args.ownerId),
        // Pending suggestions, auto-applied names (the "undo" for capture
        // evidence) and rows flagged for review can all be dismissed.
        or(
          eq(speakerAssignments.isSuggestion, true),
          eq(speakerAssignments.autoApplied, true),
          eq(speakerAssignments.needsReview, true)
        )
      )
    )
    .returning({ id: speakerAssignments.id });
  return { ok: result.length > 0 };
}
