import { db } from "@/db";
import { mediaObjects, people, speakerAssignments } from "@/db/schema";
import { and, eq } from "drizzle-orm";

export type SpeakerAssignment = typeof speakerAssignments.$inferSelect;

export type UpsertSpeakerAssignmentInput = {
  mediaObjectId: string;
  ownerId: string;
  speakerIdx: number;
  personId?: string | null;
  displayLabelOverride?: string | null;
};

async function verifyMediaOwner(mediaObjectId: string, ownerId: string) {
  const [media] = await db
    .select({ id: mediaObjects.id, ownerId: mediaObjects.ownerId })
    .from(mediaObjects)
    .where(and(eq(mediaObjects.id, mediaObjectId), eq(mediaObjects.type, "audio")))
    .limit(1);
  return media?.ownerId === ownerId;
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
  if (!(await verifyMediaOwner(input.mediaObjectId, input.ownerId))) {
    throw new Error("media_object_not_found");
  }
  await verifyPersonOwner(input.personId, input.ownerId);

  const [row] = await db
    .insert(speakerAssignments)
    .values({
      mediaObjectId: input.mediaObjectId,
      speakerIdx: input.speakerIdx,
      personId: input.personId ?? null,
      displayLabelOverride: label,
    })
    .onConflictDoUpdate({
      target: [
        speakerAssignments.mediaObjectId,
        speakerAssignments.speakerIdx,
      ],
      set: {
        personId: input.personId ?? null,
        displayLabelOverride: label,
      },
    })
    .returning();
  return row;
}

export async function listSpeakerAssignments(
  mediaObjectId: string,
  ownerId: string
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
  return rows.map((row) => row.assignment);
}

export async function deleteSpeakerAssignment(
  mediaObjectId: string,
  ownerId: string,
  speakerIdx: number
): Promise<boolean> {
  if (!(await verifyMediaOwner(mediaObjectId, ownerId))) return false;

  const result = await db
    .delete(speakerAssignments)
    .where(
      and(
        eq(speakerAssignments.mediaObjectId, mediaObjectId),
        eq(speakerAssignments.speakerIdx, speakerIdx)
      )
    )
    .returning({ id: speakerAssignments.id });
  return result.length > 0;
}
