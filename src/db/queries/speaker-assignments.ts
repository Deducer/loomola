import { db } from "@/db";
import { mediaObjects, people, speakerAssignments, transcripts } from "@/db/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import { isRowOnTranscript, PARKED_IDX_CEILING, transcriptVersionOf } from "@/lib/speaker-profile/reconcile";

export type SpeakerAssignment = typeof speakerAssignments.$inferSelect;

export type UpsertSpeakerAssignmentInput = {
  mediaObjectId: string;
  ownerId: string;
  speakerIdx: number;
  personId?: string | null;
  displayLabelOverride?: string | null;
  /** The transcript version the user was looking at when they labeled
   *  the voice. When it's no longer current the index may mean someone
   *  else (live → batch re-numbering), so the write is refused. Optional
   *  for older clients. */
  transcriptVersion?: string | null;
};

export type SpeakerMutationTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type CurrentTranscript = { version: string; createdAt: Date } | null;

/**
 * Every user speaker mutation (label, delete, accept, dismiss) runs here:
 * the note row is locked FOR NO KEY UPDATE — the same lock suggest_speakers
 * holds while it reconciles and writes — so a user write can never land
 * between the worker's read and write, or vice versa. The current
 * transcript is read under that lock; when the client says which
 * transcript it was showing and that's no longer it, the write is
 * refused ("transcript_changed") because the voice index may now mean
 * someone else.
 */
export async function withUserSpeakerLock<T>(
  args: { mediaObjectId: string; ownerId: string; expectedTranscriptVersion?: string | null },
  fn: (tx: SpeakerMutationTx, current: CurrentTranscript) => Promise<T>
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
    const [media] = await tx
      .select({ id: mediaObjects.id })
      .from(mediaObjects)
      .where(
        and(
          eq(mediaObjects.id, args.mediaObjectId),
          eq(mediaObjects.ownerId, args.ownerId),
          eq(mediaObjects.type, "audio")
        )
      )
      // Same lock strength as the worker (see withSpeakerWriteLock).
      .for("no key update");
    if (!media) throw new Error("media_object_not_found");
    const latest = () =>
      tx
        .select({ provider: transcripts.provider, createdAt: transcripts.createdAt })
        .from(transcripts)
        .where(eq(transcripts.mediaObjectId, args.mediaObjectId))
        .orderBy(desc(transcripts.createdAt))
        .limit(1);
    // If a replacement is deleting the row we wait on, FOR SHARE returns
    // nothing once it commits (READ COMMITTED skips the deleted row and
    // can't see the new one); a fresh statement does see the new row.
    const [locked] = await latest().for("share");
    const [t] = locked ? [locked] : await latest();
    const current = t ? { version: transcriptVersionOf(t.provider, t.createdAt), createdAt: t.createdAt } : null;
    if (!current && args.expectedTranscriptVersion) throw new Error("transcript_changed");
    // Required, not optional: a client that doesn't say which transcript
    // it was showing (an old desktop build) could be labeling a live
    // channel index against the batch transcript.
    if (current && !args.expectedTranscriptVersion) throw new Error("transcript_version_required");
    if (current && args.expectedTranscriptVersion !== current.version) {
      throw new Error("transcript_changed");
    }
    return fn(tx, current);
  });
}

async function verifyPersonOwner(personId: string | null | undefined, ownerId: string) {
  if (!personId) return;
  const [person] = await db
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.id, personId), eq(people.ownerId, ownerId)))
    .limit(1);
  if (!person) throw new Error("person_not_found");
}

export async function upsertSpeakerAssignment(
  input: UpsertSpeakerAssignmentInput
): Promise<SpeakerAssignment> {
  const label = input.displayLabelOverride?.trim() || null;
  if (!input.personId && !label) {
    throw new Error("speaker_assignment_invalid");
  }
  await verifyPersonOwner(input.personId, input.ownerId);

  return withUserSpeakerLock(
    {
      mediaObjectId: input.mediaObjectId,
      ownerId: input.ownerId,
      expectedTranscriptVersion: input.transcriptVersion,
    },
    async (tx, current) => {
      // The user labeled THIS transcript's voice: stamp its version so a
      // later transcript replacement reconciles the row instead of
      // trusting an index that may mean someone else. A manual label over
      // a pending or auto-applied row is a user decision from now on.
      const decision = {
        personId: input.personId ?? null,
        displayLabelOverride: label,
        isSuggestion: false,
        autoApplied: false,
        needsReview: false,
        dismissedAt: null,
        suggestedNewPersonPayload: null,
        transcriptVersion: current?.version ?? null,
      };
      const [row] = await tx
        .insert(speakerAssignments)
        .values({
          mediaObjectId: input.mediaObjectId,
          speakerIdx: input.speakerIdx,
          ...decision,
        })
        .onConflictDoUpdate({
          target: [
            speakerAssignments.mediaObjectId,
            speakerAssignments.speakerIdx,
          ],
          set: decision,
        })
        .returning();
      return row;
    }
  );
}

/**
 * Rows as clients should show them. A row whose index refers to an older
 * transcript (reconciliation pending, or failed) must not look
 * authoritative: stale pending suggestions are hidden, and stale names
 * are returned as needsReview so both clients render them as uncertain.
 */
export function presentAssignments(
  rows: SpeakerAssignment[],
  current: CurrentTranscript
): SpeakerAssignment[] {
  // Parked (superseded pre-v2) rows are retained data, never shown.
  const visible = rows.filter((row) => row.speakerIdx > PARKED_IDX_CEILING);
  if (!current) return visible;
  return visible.flatMap((row) => {
    if (row.dismissedAt !== null) return [row];
    if (isRowOnTranscript(row, current.version, current.createdAt)) return [row];
    if (row.isSuggestion) return [];
    return [{ ...row, needsReview: true }];
  });
}

/** "<provider>:<ISO created_at>" back into the transcript it names. */
export function transcriptFromVersion(version: string): CurrentTranscript {
  // The ISO timestamp itself contains colons; the provider never does.
  const sep = version.indexOf(":");
  if (sep <= 0) return null;
  const createdAt = new Date(version.slice(sep + 1));
  return Number.isNaN(createdAt.getTime()) ? null : { version, createdAt };
}

/**
 * Speaker rows as the caller should show them NEXT TO A GIVEN TRANSCRIPT.
 * Pass the transcript the caller loaded (`forTranscript`) so text and
 * names can't come from two different transcripts when a replacement
 * lands between the two reads; without it, the latest transcript is used.
 */
export async function listSpeakerAssignments(
  mediaObjectId: string,
  ownerId: string,
  forTranscript?: CurrentTranscript
): Promise<SpeakerAssignment[]> {
  const rows = await db
    .select({ assignment: speakerAssignments })
    .from(speakerAssignments)
    .innerJoin(mediaObjects, eq(mediaObjects.id, speakerAssignments.mediaObjectId))
    .where(
      and(
        eq(speakerAssignments.mediaObjectId, mediaObjectId),
        eq(mediaObjects.ownerId, ownerId),
        eq(mediaObjects.type, "audio")
      )
    );
  if (forTranscript !== undefined) {
    return presentAssignments(rows.map((row) => row.assignment), forTranscript);
  }
  const [t] = await db
    .select({ provider: transcripts.provider, createdAt: transcripts.createdAt })
    .from(transcripts)
    .where(eq(transcripts.mediaObjectId, mediaObjectId))
    .orderBy(desc(transcripts.createdAt))
    .limit(1);
  return presentAssignments(
    rows.map((row) => row.assignment),
    t ? { version: transcriptVersionOf(t.provider, t.createdAt), createdAt: t.createdAt } : null
  );
}

export async function deleteSpeakerAssignment(
  mediaObjectId: string,
  ownerId: string,
  speakerIdx: number,
  transcriptVersion: string | null
): Promise<boolean> {
  try {
    return await withUserSpeakerLock({ mediaObjectId, ownerId, expectedTranscriptVersion: transcriptVersion }, async (tx) => {
      const result = await tx
        .delete(speakerAssignments)
        .where(
          and(
            eq(speakerAssignments.mediaObjectId, mediaObjectId),
            eq(speakerAssignments.speakerIdx, speakerIdx)
          )
        )
        .returning({ id: speakerAssignments.id });
      return result.length > 0;
    });
  } catch (err) {
    if (err instanceof Error && err.message === "media_object_not_found") return false;
    throw err;
  }
}
