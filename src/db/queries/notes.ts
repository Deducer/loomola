import { db } from "@/db";
import {
  aiOutputs,
  brandProfiles,
  mediaObjects,
  noteAttachments,
  notes,
  people,
  speakerAssignments,
  transcripts,
} from "@/db/schema";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { generateSlug } from "@/lib/slug";

export type Note = typeof notes.$inferSelect;
export type NoteAttachment = typeof noteAttachments.$inferSelect;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuidIdentifier(value: string): boolean {
  return UUID_RE.test(value);
}

export type AudioNotePageData = {
  media: typeof mediaObjects.$inferSelect;
  brandProfile: typeof brandProfiles.$inferSelect | null;
  note: Note | null;
  transcript: typeof transcripts.$inferSelect | null;
  aiOutput: typeof aiOutputs.$inferSelect | null;
};

export type ObsidianPendingNote = {
  id: string;
  slug: string;
  title: string | null;
  aiTitle: string | null;
  createdAt: Date;
  meetingNotesVaultPath: string | null;
};

export type AudioNoteAccess = {
  id: string;
  ownerId: string;
  slug: string;
  title: string | null;
  status: typeof mediaObjects.$inferSelect.status;
  failureReason: string | null;
  r2MixedKey: string | null;
  r2MicKey: string | null;
  r2SystemaudioKey: string | null;
  obsidianSaveRequestedAt: Date | null;
  obsidianSyncedAt: Date | null;
  meetingNotesVaultPath: string | null;
  templateId: string | null;
};

export type AudioNoteEnhancementStatus = {
  mediaId: string;
  mediaStatus: typeof mediaObjects.$inferSelect.status;
  failureReason: string | null;
  r2MixedKey: string | null;
  r2MicKey: string | null;
  r2SystemaudioKey: string | null;
  noteTemplateId: string | null;
  titleSuggested: string | null;
  summary: string | null;
  chapters: unknown;
  actionItems: unknown;
  aiTemplateId: string | null;
  generationStatus: string | null;
  transcriptTextLength: number | null;
};

export class AttendeeUpdateError extends Error {
  constructor(
    message:
      | "media_object_not_found"
      | "person_not_found"
      | "self_person_not_attendee"
  ) {
    super(message);
    this.name = "AttendeeUpdateError";
  }
}

function audioNoteIdentifierWhere(identifier: string) {
  return isUuidIdentifier(identifier)
    ? or(eq(mediaObjects.id, identifier), eq(mediaObjects.slug, identifier))
    : eq(mediaObjects.slug, identifier);
}

function audioNoteOwnerWhere(identifier: string, ownerId: string) {
  return and(
    audioNoteIdentifierWhere(identifier),
    eq(mediaObjects.ownerId, ownerId),
    eq(mediaObjects.type, "audio"),
    isNull(mediaObjects.deletedAt)
  );
}

export async function createQuickAudioNote(ownerId: string): Promise<{
  id: string;
  slug: string;
}> {
  const [row] = await db
    .insert(mediaObjects)
    .values({
      ownerId,
      type: "audio",
      slug: generateSlug(),
      status: "ready",
    })
    .returning({ id: mediaObjects.id, slug: mediaObjects.slug });

  return row;
}

export async function upsertNotesBody(
  mediaObjectId: string,
  ownerId: string,
  body: string
): Promise<Note> {
  const [media] = await db
    .select({ id: mediaObjects.id, ownerId: mediaObjects.ownerId })
    .from(mediaObjects)
    .where(and(eq(mediaObjects.id, mediaObjectId), eq(mediaObjects.type, "audio")))
    .limit(1);

  if (!media || media.ownerId !== ownerId) {
    throw new Error("media_object_not_found");
  }

  const [row] = await db
    .insert(notes)
    .values({ mediaObjectId, ownerId, body })
    .onConflictDoUpdate({
      target: notes.mediaObjectId,
      set: { body, updatedAt: sql`now()` },
    })
    .returning();

  return row;
}

export async function upsertNoteTemplate(
  mediaObjectId: string,
  ownerId: string,
  templateId: string
): Promise<Note> {
  const [media] = await db
    .select({ id: mediaObjects.id, ownerId: mediaObjects.ownerId })
    .from(mediaObjects)
    .where(and(eq(mediaObjects.id, mediaObjectId), eq(mediaObjects.type, "audio")))
    .limit(1);

  if (!media || media.ownerId !== ownerId) {
    throw new Error("media_object_not_found");
  }

  const [row] = await db
    .insert(notes)
    .values({ mediaObjectId, ownerId, templateId })
    .onConflictDoUpdate({
      target: notes.mediaObjectId,
      set: { templateId, updatedAt: sql`now()` },
    })
    .returning();

  return row;
}

export async function updateAudioNoteAttendees(params: {
  mediaObjectId: string;
  ownerId: string;
  personIds: string[];
}): Promise<string[]> {
  const personIds = Array.from(new Set(params.personIds));

  if (personIds.length > 0) {
    const rows = await db
      .select({ id: people.id, isSelf: people.isSelf })
      .from(people)
      .where(
        and(
          eq(people.ownerId, params.ownerId),
          inArray(people.id, personIds)
        )
      );
    if (rows.length !== personIds.length) {
      throw new AttendeeUpdateError("person_not_found");
    }
    if (rows.some((row) => row.isSelf)) {
      throw new AttendeeUpdateError("self_person_not_attendee");
    }
  }

  const [row] = await db
    .update(mediaObjects)
    .set({
      attendees: personIds,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(mediaObjects.id, params.mediaObjectId),
        eq(mediaObjects.ownerId, params.ownerId),
        eq(mediaObjects.type, "audio"),
        isNull(mediaObjects.deletedAt)
      )
    )
    .returning({ attendees: mediaObjects.attendees });

  if (!row) throw new AttendeeUpdateError("media_object_not_found");

  await db
    .delete(speakerAssignments)
    .where(
      and(
        eq(speakerAssignments.mediaObjectId, params.mediaObjectId),
        eq(speakerAssignments.isSuggestion, true)
      )
    );

  return Array.isArray(row.attendees)
    ? row.attendees.filter((item): item is string => typeof item === "string")
    : [];
}

export async function getNotesByMediaObject(
  mediaObjectId: string,
  ownerId: string
): Promise<Note | null> {
  const [row] = await db
    .select()
    .from(notes)
    .where(
      and(eq(notes.mediaObjectId, mediaObjectId), eq(notes.ownerId, ownerId))
    )
    .limit(1);

  return row ?? null;
}

export async function getNotesByMediaObjectForJob(
  mediaObjectId: string
): Promise<Note | null> {
  const [row] = await db
    .select()
    .from(notes)
    .where(eq(notes.mediaObjectId, mediaObjectId))
    .limit(1);

  return row ?? null;
}

export async function listNoteAttachments(
  mediaObjectId: string,
  ownerId: string
): Promise<NoteAttachment[]> {
  return db
    .select()
    .from(noteAttachments)
    .where(
      and(
        eq(noteAttachments.mediaObjectId, mediaObjectId),
        eq(noteAttachments.ownerId, ownerId)
      )
    )
    .orderBy(desc(noteAttachments.createdAt));
}

/** Lookup the first ~4 image attachments for each of the supplied media
 *  ids in one round trip. Used by the notes list to render attached-image
 *  thumbnails in place of the generic waveform icon. Empty input → empty
 *  output. Only image-kind attachments are returned. */
export async function listImageAttachmentsForMediaIds(
  mediaObjectIds: ReadonlyArray<string>,
  ownerId: string
): Promise<Map<string, NoteAttachment[]>> {
  const result = new Map<string, NoteAttachment[]>();
  if (mediaObjectIds.length === 0) return result;
  const rows = await db
    .select()
    .from(noteAttachments)
    .where(
      and(
        eq(noteAttachments.ownerId, ownerId),
        inArray(noteAttachments.mediaObjectId, [...mediaObjectIds]),
        eq(noteAttachments.kind, "image")
      )
    )
    .orderBy(desc(noteAttachments.createdAt));
  for (const row of rows) {
    const list = result.get(row.mediaObjectId) ?? [];
    if (list.length < 4) list.push(row);
    result.set(row.mediaObjectId, list);
  }
  return result;
}

export async function listNoteAttachmentsForJob(
  mediaObjectId: string
): Promise<NoteAttachment[]> {
  return db
    .select()
    .from(noteAttachments)
    .where(eq(noteAttachments.mediaObjectId, mediaObjectId))
    .orderBy(desc(noteAttachments.createdAt));
}

export async function createNoteAttachment(params: {
  mediaObjectId: string;
  ownerId: string;
  r2Key: string;
  filename: string;
  contentType: string;
  byteSize: number;
}): Promise<NoteAttachment> {
  const [row] = await db
    .insert(noteAttachments)
    .values({
      mediaObjectId: params.mediaObjectId,
      ownerId: params.ownerId,
      r2Key: params.r2Key,
      filename: params.filename,
      contentType: params.contentType,
      byteSize: params.byteSize,
    })
    .returning();

  return row;
}

export async function deleteNoteAttachment(params: {
  id: string;
  mediaObjectId: string;
  ownerId: string;
}): Promise<boolean> {
  const rows = await db
    .delete(noteAttachments)
    .where(
      and(
        eq(noteAttachments.id, params.id),
        eq(noteAttachments.mediaObjectId, params.mediaObjectId),
        eq(noteAttachments.ownerId, params.ownerId)
      )
    )
    .returning({ id: noteAttachments.id });

  return rows.length > 0;
}

export async function getAudioNotePageData(
  identifier: string,
  ownerId: string
): Promise<AudioNotePageData | null> {
  const [row] = await db
    .select({
      media: mediaObjects,
      brandProfile: brandProfiles,
      note: notes,
      transcript: transcripts,
      aiOutput: aiOutputs,
    })
    .from(mediaObjects)
    .leftJoin(brandProfiles, eq(mediaObjects.brandProfileId, brandProfiles.id))
    .leftJoin(notes, eq(notes.mediaObjectId, mediaObjects.id))
    .leftJoin(transcripts, eq(transcripts.mediaObjectId, mediaObjects.id))
    .leftJoin(aiOutputs, eq(aiOutputs.mediaObjectId, mediaObjects.id))
    .where(audioNoteOwnerWhere(identifier, ownerId))
    .limit(1);

  return row ?? null;
}

export async function getAudioNoteAccess(
  identifier: string,
  ownerId: string
): Promise<AudioNoteAccess | null> {
  const [row] = await db
    .select({
      id: mediaObjects.id,
      ownerId: mediaObjects.ownerId,
      slug: mediaObjects.slug,
      title: mediaObjects.title,
      status: mediaObjects.status,
      failureReason: mediaObjects.failureReason,
      r2MixedKey: mediaObjects.r2MixedKey,
      r2MicKey: mediaObjects.r2MicKey,
      r2SystemaudioKey: mediaObjects.r2SystemaudioKey,
      obsidianSaveRequestedAt: mediaObjects.obsidianSaveRequestedAt,
      obsidianSyncedAt: mediaObjects.obsidianSyncedAt,
      meetingNotesVaultPath: brandProfiles.meetingNotesVaultPath,
      templateId: notes.templateId,
    })
    .from(mediaObjects)
    .leftJoin(brandProfiles, eq(mediaObjects.brandProfileId, brandProfiles.id))
    .leftJoin(notes, eq(notes.mediaObjectId, mediaObjects.id))
    .where(audioNoteOwnerWhere(identifier, ownerId))
    .limit(1);

  return row ?? null;
}

export async function getAudioNoteEnhancementStatus(
  identifier: string,
  ownerId: string
): Promise<AudioNoteEnhancementStatus | null> {
  const [row] = await db
    .select({
      mediaId: mediaObjects.id,
      mediaStatus: mediaObjects.status,
      failureReason: mediaObjects.failureReason,
      r2MixedKey: mediaObjects.r2MixedKey,
      r2MicKey: mediaObjects.r2MicKey,
      r2SystemaudioKey: mediaObjects.r2SystemaudioKey,
      noteTemplateId: notes.templateId,
      titleSuggested: aiOutputs.titleSuggested,
      summary: aiOutputs.summary,
      chapters: aiOutputs.chapters,
      actionItems: aiOutputs.actionItems,
      aiTemplateId: aiOutputs.templateId,
      generationStatus: aiOutputs.generationStatusValue,
      transcriptTextLength: sql<number | null>`length(btrim(${transcripts.fullText}))::int`,
    })
    .from(mediaObjects)
    .leftJoin(notes, eq(notes.mediaObjectId, mediaObjects.id))
    .leftJoin(transcripts, eq(transcripts.mediaObjectId, mediaObjects.id))
    .leftJoin(aiOutputs, eq(aiOutputs.mediaObjectId, mediaObjects.id))
    .where(audioNoteOwnerWhere(identifier, ownerId))
    .limit(1);

  return row ?? null;
}

export async function getAudioNoteOwnerId(
  identifier: string
): Promise<string | null> {
  const mediaWhere = isUuidIdentifier(identifier)
    ? or(eq(mediaObjects.id, identifier), eq(mediaObjects.slug, identifier))
    : eq(mediaObjects.slug, identifier);

  const [row] = await db
    .select({ ownerId: mediaObjects.ownerId })
    .from(mediaObjects)
    .where(
      and(
        mediaWhere,
        eq(mediaObjects.type, "audio"),
        isNull(mediaObjects.deletedAt)
      )
    )
    .limit(1);

  return row?.ownerId ?? null;
}

export async function markObsidianSaveRequested(
  mediaObjectId: string,
  ownerId: string
): Promise<boolean> {
  const [row] = await db
    .update(mediaObjects)
    .set({
      obsidianSaveRequestedAt: sql`now()`,
      obsidianSyncedAt: null,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(mediaObjects.id, mediaObjectId),
        eq(mediaObjects.ownerId, ownerId),
        eq(mediaObjects.type, "audio"),
        isNull(mediaObjects.deletedAt)
      )
    )
    .returning({ id: mediaObjects.id });

  return !!row;
}

export async function listObsidianPendingNotes(
  ownerId: string
): Promise<ObsidianPendingNote[]> {
  return db
    .select({
      id: mediaObjects.id,
      slug: mediaObjects.slug,
      title: mediaObjects.title,
      aiTitle: aiOutputs.titleSuggested,
      createdAt: mediaObjects.createdAt,
      meetingNotesVaultPath: brandProfiles.meetingNotesVaultPath,
    })
    .from(mediaObjects)
    .leftJoin(aiOutputs, eq(aiOutputs.mediaObjectId, mediaObjects.id))
    .leftJoin(brandProfiles, eq(mediaObjects.brandProfileId, brandProfiles.id))
    .where(
      and(
        eq(mediaObjects.ownerId, ownerId),
        eq(mediaObjects.type, "audio"),
        isNull(mediaObjects.deletedAt),
        sql`${mediaObjects.obsidianSaveRequestedAt} IS NOT NULL`,
        isNull(mediaObjects.obsidianSyncedAt)
      )
    );
}

export async function markObsidianSynced(
  mediaObjectId: string,
  ownerId: string
): Promise<boolean> {
  const [row] = await db
    .update(mediaObjects)
    .set({
      obsidianSaveRequestedAt: null,
      obsidianSyncedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(mediaObjects.id, mediaObjectId),
        eq(mediaObjects.ownerId, ownerId),
        eq(mediaObjects.type, "audio"),
        isNull(mediaObjects.deletedAt)
      )
    )
    .returning({ id: mediaObjects.id });

  return !!row;
}

export async function deleteNotes(
  mediaObjectId: string,
  ownerId: string
): Promise<boolean> {
  const result = await db
    .delete(notes)
    .where(
      and(eq(notes.mediaObjectId, mediaObjectId), eq(notes.ownerId, ownerId))
    )
    .returning({ id: notes.id });

  return result.length > 0;
}
