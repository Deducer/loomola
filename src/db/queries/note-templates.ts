import { db } from "@/db";
import { noteTemplates } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import {
  DEFAULT_NOTE_TEMPLATE_ID,
  SYSTEM_NOTE_TEMPLATES,
  getNoteTemplate,
  isSystemNoteTemplateId,
  type NoteTemplate,
  type NoteTemplateSection,
} from "@/lib/ai/note-templates";

function toNoteTemplate(row: typeof noteTemplates.$inferSelect): NoteTemplate {
  const sections = Array.isArray(row.sections)
    ? (row.sections as NoteTemplateSection[]).filter(
        (s) => typeof s?.title === "string" && typeof s?.prompt === "string"
      )
    : [];
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    description: row.description,
    meetingContext: row.meetingContext,
    sections,
  };
}

export async function listUserNoteTemplates(
  ownerId: string
): Promise<NoteTemplate[]> {
  const rows = await db
    .select()
    .from(noteTemplates)
    .where(eq(noteTemplates.ownerId, ownerId))
    .orderBy(noteTemplates.name);
  return rows.map(toNoteTemplate);
}

export async function getUserNoteTemplate(
  ownerId: string,
  id: string
): Promise<NoteTemplate | null> {
  const [row] = await db
    .select()
    .from(noteTemplates)
    .where(and(eq(noteTemplates.ownerId, ownerId), eq(noteTemplates.id, id)))
    .limit(1);
  return row ? toNoteTemplate(row) : null;
}

/** Built-ins + the user's own templates — the picker list. */
export async function listNoteTemplatesForOwner(
  ownerId: string
): Promise<NoteTemplate[]> {
  const custom = await listUserNoteTemplates(ownerId);
  return [...SYSTEM_NOTE_TEMPLATES, ...custom];
}

/**
 * Resolution order: the user's own template → built-in → default.
 * User templates win id collisions so someone can override a built-in
 * shape without forking the code.
 */
export async function resolveNoteTemplate(
  ownerId: string,
  templateId: string | null | undefined
): Promise<NoteTemplate> {
  if (templateId) {
    const custom = await getUserNoteTemplate(ownerId, templateId);
    if (custom) return custom;
  }
  return getNoteTemplate(templateId);
}

export async function isKnownNoteTemplateId(
  ownerId: string,
  templateId: string
): Promise<boolean> {
  if (isSystemNoteTemplateId(templateId)) return true;
  return (await getUserNoteTemplate(ownerId, templateId)) !== null;
}

export async function upsertUserNoteTemplate(params: {
  ownerId: string;
  id: string;
  name: string;
  category?: string;
  description?: string;
  meetingContext: string;
  sections: NoteTemplateSection[];
}): Promise<NoteTemplate> {
  const [row] = await db
    .insert(noteTemplates)
    .values({
      ownerId: params.ownerId,
      id: params.id,
      name: params.name,
      category: params.category ?? "Custom",
      description: params.description ?? "",
      meetingContext: params.meetingContext,
      sections: params.sections,
    })
    .onConflictDoUpdate({
      target: [noteTemplates.ownerId, noteTemplates.id],
      set: {
        name: params.name,
        category: params.category ?? "Custom",
        description: params.description ?? "",
        meetingContext: params.meetingContext,
        sections: params.sections,
        updatedAt: sql`now()`,
      },
    })
    .returning();
  return toNoteTemplate(row);
}

export async function deleteUserNoteTemplate(
  ownerId: string,
  id: string
): Promise<boolean> {
  const result = await db
    .delete(noteTemplates)
    .where(and(eq(noteTemplates.ownerId, ownerId), eq(noteTemplates.id, id)))
    .returning({ id: noteTemplates.id });
  return result.length > 0;
}

export { DEFAULT_NOTE_TEMPLATE_ID };
