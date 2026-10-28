import { db } from "@/db";
import {
  mediaObjects,
  people,
  speakerAssignments,
  transcripts,
} from "@/db/schema";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { WordTimestamp } from "@/db/queries/transcripts";
import type { PersonCandidate } from "@/lib/speaker-suggestion/match-person";
import type { SpeakerSuggestion } from "@/lib/speaker-suggestion/compose";
import type { SpeakerProfile } from "@/lib/speaker-profile/profile";
import { isRowOnTranscript, type ReconcilePlan, type ReconcileRow } from "@/lib/speaker-profile/reconcile";
import { withUserSpeakerLock } from "@/db/queries/speaker-assignments";

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

/** Records the outcome of the LLM pass on the transcript's profile —
 *  only if the profile is still the one this run wrote (`runId`). A newer
 *  run, an attendee edit (which clears the profile) or a replaced
 *  transcript all make this a no-op. */
export async function setSpeakerLlmStatus(
  transcriptId: string,
  runId: string,
  status: "done" | "failed"
): Promise<void> {
  await db
    .update(transcripts)
    .set({ speakerProfile: sql`jsonb_set(${transcripts.speakerProfile}, '{llm}', to_jsonb(${status}::text))` })
    .where(and(eq(transcripts.id, transcriptId), sql`${transcripts.speakerProfile}->>'runId' = ${runId}`));
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
 *  - the media_objects row is locked FOR NO KEY UPDATE, serializing concurrent
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
    // NO KEY UPDATE, not UPDATE: transcript replacement inserts a row
    // whose foreign key takes KEY SHARE on this note row while it holds
    // the old transcript's row lock. FOR UPDATE would block that insert
    // while we wait on the old transcript — a deadlock. NO KEY UPDATE
    // still serializes with attendee edits, other jobs and user writes.
    const [media] = await tx
      .select({ id: mediaObjects.id, attendees: mediaObjects.attendees })
      .from(mediaObjects)
      .where(eq(mediaObjects.id, args.mediaObjectId))
      .for("no key update");
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

/** Used by the API to apply an accepted suggestion: flip is_suggestion
 *  to false, optionally set person_id (when accepting a "create new
 *  person" suggestion the API does the INSERT into people first). Runs
 *  under the same note lock as the worker; a suggestion that belongs to
 *  an older transcript (reconcile pending) can't be accepted — its index
 *  may mean someone else now. */
export async function applySpeakerSuggestion(args: {
  mediaObjectId: string;
  ownerId: string;
  speakerIdx: number;
  displayLabelOverride?: string | null;
  transcriptVersion?: string | null;
} & (
  /** Accepting "this voice is <existing person>": must be the person the
   *  suggestion names now. */
  | { personId: string; createPerson?: never }
  /** Accepting a "new person" suggestion: must match the name/email the
   *  suggestion shows now; the person is created inside the same locked
   *  transaction, so a refused accept leaves no orphan person. */
  | { personId?: never; createPerson: { displayName: string; email: string | null } }
)): Promise<{
  ok: boolean;
  personId?: string;
  reason?: "no_pending_suggestion" | "transcript_changed" | "transcript_version_required" | "suggestion_changed";
}> {
  try {
    return await withUserSpeakerLock(
      { mediaObjectId: args.mediaObjectId, ownerId: args.ownerId, expectedTranscriptVersion: args.transcriptVersion },
      async (tx, current) => {
        const [row] = await tx
          .select({
            id: speakerAssignments.id,
            personId: speakerAssignments.personId,
            suggestedNewPersonPayload: speakerAssignments.suggestedNewPersonPayload,
            displayLabelOverride: speakerAssignments.displayLabelOverride,
            transcriptVersion: speakerAssignments.transcriptVersion,
            suggestedAt: speakerAssignments.suggestedAt,
            createdAt: speakerAssignments.createdAt,
          })
          .from(speakerAssignments)
          .where(
            and(
              eq(speakerAssignments.mediaObjectId, args.mediaObjectId),
              eq(speakerAssignments.speakerIdx, args.speakerIdx),
              eq(speakerAssignments.isSuggestion, true)
            )
          )
          .for("update");
        if (!row) return { ok: false, reason: "no_pending_suggestion" as const };
        if (current && !isRowOnTranscript(row, current.version, current.createdAt)) {
          return { ok: false, reason: "transcript_changed" as const };
        }
        // Accept means "yes, the person you suggested" — bound to the
        // suggestion actually on this voice now. A client holding an older
        // suggestion for this index (recomputed since) must not apply its
        // person to whoever the voice is suggested as today.
        let personId: string;
        if (args.createPerson) {
          const payload = (row.suggestedNewPersonPayload ?? null) as
            | { displayName?: string | null; email?: string | null }
            | null;
          const shownName = payload?.displayName ?? row.displayLabelOverride ?? null;
          const sameNewPerson =
            row.personId === null &&
            shownName !== null &&
            shownName.trim().toLowerCase() === args.createPerson.displayName.trim().toLowerCase() &&
            (payload?.email ?? null) === (args.createPerson.email ?? null);
          if (!sameNewPerson) return { ok: false, reason: "suggestion_changed" as const };
          const [created] = await tx
            .insert(people)
            .values({
              ownerId: args.ownerId,
              displayName: args.createPerson.displayName,
              email: args.createPerson.email,
            })
            .returning({ id: people.id });
          personId = created.id;
        } else {
          if (row.personId !== args.personId) return { ok: false, reason: "suggestion_changed" as const };
          personId = args.personId;
        }
        await tx
          .update(speakerAssignments)
          .set({
            personId,
            displayLabelOverride: args.displayLabelOverride ?? null,
            isSuggestion: false,
            autoApplied: false,
            needsReview: false,
            suggestedNewPersonPayload: null,
          })
          .where(eq(speakerAssignments.id, row.id));
        return { ok: true, personId };
      }
    );
  } catch (err) {
    if (err instanceof Error && (err.message === "transcript_changed" || err.message === "transcript_version_required")) {
      return { ok: false, reason: err.message };
    }
    if (err instanceof Error && err.message === "media_object_not_found") {
      return { ok: false, reason: "no_pending_suggestion" };
    }
    throw err;
  }
}

/** Used by the API to dismiss ("Not <name>") a pending suggestion, an
 *  auto-applied name, or a name flagged for review. The row becomes a
 *  dismissal marker (dismissed_at set) so the worker won't re-suggest it.
 *  Idempotent; runs under the same note lock as the worker. */
export async function dismissSpeakerSuggestion(args: {
  mediaObjectId: string;
  ownerId: string;
  speakerIdx: number;
  transcriptVersion?: string | null;
}): Promise<{ ok: boolean; reason?: "transcript_changed" | "transcript_version_required" }> {
  try {
    return await withUserSpeakerLock(
      { mediaObjectId: args.mediaObjectId, ownerId: args.ownerId, expectedTranscriptVersion: args.transcriptVersion },
      async (tx, current) => {
        const [row] = await tx
          .select({
            id: speakerAssignments.id,
            isSuggestion: speakerAssignments.isSuggestion,
            autoApplied: speakerAssignments.autoApplied,
            needsReview: speakerAssignments.needsReview,
            dismissedAt: speakerAssignments.dismissedAt,
            transcriptVersion: speakerAssignments.transcriptVersion,
            suggestedAt: speakerAssignments.suggestedAt,
            createdAt: speakerAssignments.createdAt,
          })
          .from(speakerAssignments)
          .where(
            and(
              eq(speakerAssignments.mediaObjectId, args.mediaObjectId),
              eq(speakerAssignments.speakerIdx, args.speakerIdx)
            )
          )
          .for("update");
        if (!row || row.dismissedAt !== null) return { ok: false };
        // Pending suggestions, auto-applied names (the undo for capture
        // evidence), rows flagged for review — and names on an older
        // transcript, which clients show as needing review — can all be
        // dismissed. A current confirmed name is changed by relabeling.
        const stale = current !== null && !isRowOnTranscript(row, current.version, current.createdAt);
        if (!row.isSuggestion && !row.autoApplied && !row.needsReview && !stale) return { ok: false };
        await tx
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
          .where(eq(speakerAssignments.id, row.id));
        return { ok: true };
      }
    );
  } catch (err) {
    if (err instanceof Error && (err.message === "transcript_changed" || err.message === "transcript_version_required")) {
      return { ok: false, reason: err.message };
    }
    if (err instanceof Error && err.message === "media_object_not_found") return { ok: false };
    throw err;
  }
}
