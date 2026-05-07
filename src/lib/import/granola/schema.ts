// Zod schema for the POST /api/import/granola/note request body.
// Spec: docs/superpowers/specs/2026-05-06-granola-migration-tool-design.md
//
// The CLI emits one of these per Granola note. The server route handler
// translates this into Loomola's polymorphic schema inside one
// transaction under the merge / fill-the-gaps idempotency rule.

import { z } from "zod";

export const granolaSegmentSchema = z.object({
  granolaPersonId: z.string().nullable(),
  text: z.string(),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
});

export const granolaTranscriptSchema = z.object({
  segments: z.array(granolaSegmentSchema),
  fullText: z.string(),
});

export const granolaAttendeeSchema = z.object({
  granolaPersonId: z.string(),
  name: z.string(),
  email: z.string().email().nullable(),
  isSelf: z.boolean(),
});

export const granolaListSchema = z.object({
  granolaListId: z.string(),
  name: z.string(),
});

export const granolaNoteImportSchema = z.object({
  granolaId: z.string().min(1),
  title: z.string(),
  createdAt: z.string().datetime(),
  durationSeconds: z.number().nullable(),
  notesBody: z.string(),
  aiSummary: z.string(),
  meetingUrl: z.string().url().nullable(),
  attendees: z.array(granolaAttendeeSchema),
  lists: z.array(granolaListSchema),
  transcript: granolaTranscriptSchema.nullable(),
  // Force-update body + ai summary even when the target row already has
  // non-empty values. Used to backfill formatting (markdown vs. plain
  // text) on previously-imported rows. Default false — normal merge
  // / fill-the-gaps idempotency.
  replaceContent: z.boolean().optional().default(false),
});

export type GranolaSegment = z.infer<typeof granolaSegmentSchema>;
export type GranolaAttendee = z.infer<typeof granolaAttendeeSchema>;
export type GranolaList = z.infer<typeof granolaListSchema>;
export type GranolaNoteImportPayload = z.infer<typeof granolaNoteImportSchema>;

export type GranolaNoteImportResult = {
  mediaObjectId: string;
  action: "created" | "updated" | "unchanged";
  warnings: string[];
};
