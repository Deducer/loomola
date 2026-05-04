import { z } from "zod";

export const titleSummarySchema = z.object({
  title: z
    .string()
    .min(3)
    .max(120)
    .describe("A concise, descriptive title — 3 to 12 words, sentence case, no trailing period."),
  summary: z
    .string()
    .min(10)
    .max(600)
    .describe("A 2-3 sentence summary of what the recording covers."),
});

export type TitleSummary = z.infer<typeof titleSummarySchema>;

export const enhancedNotesSchema = z.object({
  title: z
    .string()
    .min(3)
    .max(120)
    .describe("A concise meeting-note title — 3 to 12 words, sentence case, no trailing period."),
  summary: z
    .string()
    .min(10)
    // Sized for the longest practical use case — 5-6 hour event recordings
    // can produce ~50-80 KB of structured markdown notes. The cap is a
    // sanity guard against runaway generations, not a content limit.
    .max(200000)
    .describe("Polished markdown meeting notes generated from raw notes and transcript context."),
});

export type EnhancedNotes = z.infer<typeof enhancedNotesSchema>;

export const chaptersSchema = z.object({
  chapters: z
    .array(
      z.object({
        start_sec: z
          .number()
          .min(0)
          .describe("Start timestamp in seconds (>= 0, within recording duration)."),
        title: z
          .string()
          .min(2)
          .max(80)
          .describe("Chapter title — 2 to 10 words, sentence case, no trailing period."),
      })
    )
    .describe(
      "Chapter markers. Return an EMPTY array if the recording is too short (< 60s) or single-topic with no natural divisions."
    ),
});

export type Chapters = z.infer<typeof chaptersSchema>;

export const actionItemsSchema = z.object({
  action_items: z
    .array(
      z.object({
        text: z
          .string()
          .min(3)
          .max(240)
          .describe("Action item as a single imperative sentence."),
        timestamp_sec: z
          .number()
          .min(0)
          .describe(
            "Timestamp in seconds (>= 0) where this item was discussed. If unclear, use the start of the relevant section."
          ),
      })
    )
    .describe(
      "Action items spoken or committed to during the recording. Return an EMPTY array if the recording has no concrete next steps."
    ),
});

export type ActionItems = z.infer<typeof actionItemsSchema>;

// ---------------------------------------------------------------------------
// Folder-suggestion classifier — picks one of the user's existing folders
// for a newly-processed note, or null. The worker gates on confidence ===
// 'high' and rejects hallucinated folder ids server-side.
// ---------------------------------------------------------------------------

export const folderSuggestionSchema = z.object({
  folderId: z
    .string()
    .uuid()
    .nullable()
    .describe(
      "The single best-fit folder id from the supplied USER'S FOLDERS list, or null if no folder clearly fits."
    ),
  confidence: z
    .enum(["low", "medium", "high"])
    .describe(
      "Use 'high' only when you are sure. False matches are worse than no match."
    ),
  reason: z
    .string()
    .max(200)
    .describe("One short sentence explaining the choice (or why none fit)."),
});

export type FolderSuggestion = z.infer<typeof folderSuggestionSchema>;
