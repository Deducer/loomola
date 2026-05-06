import { db } from "@/db";
import {
  aiOutputs,
  folders,
  mediaFolderAssignments,
  mediaObjects,
  notes,
  transcripts,
} from "@/db/schema";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import type { SuggestionFolderInput, SuggestionNoteInput } from "@/lib/folder-suggestion/build-prompt";

const FOLDER_LIMIT = 12;
const RECENT_TITLES_PER_FOLDER = 5;

export interface NoteForSuggestion {
  ownerId: string;
  type: "video" | "audio";
  folderId: string | null;
  suggestedFolderId: string | null;
  suggestedFolderDismissedAt: Date | null;
  aiUpdatedAt: Date | null;
  /** Composed input for the classifier — caller passes this directly to
   *  `buildFolderSuggestionPrompt`. */
  input: SuggestionNoteInput;
}

/** Loads the data the suggest_folder worker needs to decide whether to run
 *  the classifier and what to feed it. Returns null if the row is missing
 *  or has no transcript yet. */
export async function getNoteForSuggestion(
  mediaObjectId: string
): Promise<NoteForSuggestion | null> {
  const [row] = await db
    .select({
      ownerId: mediaObjects.ownerId,
      type: mediaObjects.type,
      title: mediaObjects.title,
      folderId: mediaObjects.folderId,
      suggestedFolderId: mediaObjects.suggestedFolderId,
      suggestedFolderDismissedAt: mediaObjects.suggestedFolderDismissedAt,
      attendees: mediaObjects.attendees,
      sourceContextHint: mediaObjects.sourceContextHint,
      transcriptText: transcripts.fullText,
      aiTitle: aiOutputs.titleSuggested,
      aiSummary: aiOutputs.summary,
      aiUpdatedAt: aiOutputs.generatedAt,
    })
    .from(mediaObjects)
    .leftJoin(transcripts, eq(transcripts.mediaObjectId, mediaObjects.id))
    .leftJoin(aiOutputs, eq(aiOutputs.mediaObjectId, mediaObjects.id))
    .where(eq(mediaObjects.id, mediaObjectId))
    .limit(1);

  if (!row) return null;

  const attendeeNames = parseAttendeeNames(row.attendees);
  const transcriptExcerpt = row.transcriptText ?? "";
  const summary = row.aiSummary ?? "";
  const titleForPrompt =
    (row.title?.trim() || row.aiTitle?.trim() || "Untitled note");

  return {
    ownerId: row.ownerId,
    type: row.type,
    folderId: row.folderId ?? null,
    suggestedFolderId: row.suggestedFolderId ?? null,
    suggestedFolderDismissedAt: row.suggestedFolderDismissedAt ?? null,
    aiUpdatedAt: row.aiUpdatedAt ?? null,
    input: {
      title: titleForPrompt,
      summary,
      transcriptExcerpt,
      attendeeNames,
      sourceContextHint: row.sourceContextHint ?? null,
    },
  };
}

function parseAttendeeNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      if (typeof entry === "string") return entry;
      if (entry && typeof entry === "object" && "name" in entry) {
        const name = (entry as { name?: unknown }).name;
        return typeof name === "string" ? name : null;
      }
      return null;
    })
    .filter((s): s is string => Boolean(s && s.trim()))
    .slice(0, 8);
}

/** Returns the user's most-recently-modified folders (up to 12), each with
 *  the titles of their 5 most recent notes. Empty list if the user has no
 *  folders. */
export async function getCandidateFolders(
  ownerId: string
): Promise<SuggestionFolderInput[]> {
  const folderRows = await db
    .select({
      id: folders.id,
      name: folders.name,
      updatedAt: folders.updatedAt,
    })
    .from(folders)
    .where(eq(folders.ownerId, ownerId))
    .orderBy(desc(folders.updatedAt))
    .limit(FOLDER_LIMIT);

  if (folderRows.length === 0) return [];

  const ids = folderRows.map((r) => r.id);

  // One round trip: pull the most recent N titles per folder via a window
  // function. Returns rows with (folderId, title, rn).
  const titleRows = await db.execute<{
    folder_id: string;
    title: string | null;
  }>(sql`
    SELECT folder_id, title
    FROM (
      SELECT
        ${mediaObjects.folderId} AS folder_id,
        COALESCE(${mediaObjects.title}, '') AS title,
        ROW_NUMBER() OVER (
          PARTITION BY ${mediaObjects.folderId}
          ORDER BY ${mediaObjects.updatedAt} DESC
        ) AS rn
      FROM ${mediaObjects}
      WHERE ${and(
        isNotNull(mediaObjects.folderId),
        eq(mediaObjects.ownerId, ownerId)
      )}
    ) sub
    WHERE rn <= ${RECENT_TITLES_PER_FOLDER}
      AND folder_id = ANY(${ids})
    ORDER BY folder_id, rn
  `);

  const titlesByFolder = new Map<string, string[]>();
  for (const row of titleRows as unknown as Array<{
    folder_id: string;
    title: string | null;
  }>) {
    if (!row.folder_id) continue;
    const t = (row.title ?? "").trim();
    if (!t) continue;
    const arr = titlesByFolder.get(row.folder_id) ?? [];
    arr.push(t);
    titlesByFolder.set(row.folder_id, arr);
  }

  return folderRows.map((f) => ({
    id: f.id,
    name: f.name,
    recentNoteTitles: titlesByFolder.get(f.id) ?? [],
  }));
}

export interface PersistSuggestionParams {
  mediaObjectId: string;
  folderId: string;
}

/** Atomically writes the suggestion. Also clears any prior dismissal stamp
 *  so a regenerated AI cycle can land a fresh suggestion. */
export async function persistSuggestion(
  params: PersistSuggestionParams
): Promise<void> {
  await db
    .update(mediaObjects)
    .set({
      suggestedFolderId: params.folderId,
      suggestedFolderAt: new Date(),
      suggestedFolderDismissedAt: null,
    })
    .where(eq(mediaObjects.id, params.mediaObjectId));
}

export interface AcceptSuggestionResult {
  folderId: string;
  folderName: string;
}

/** Applies the pending suggestion: sets folder_id from suggested_folder_id
 *  and clears the suggestion fields. Atomic UPDATE-RETURNING gated on
 *  ownership AND a non-null suggestion. Returns null if no row was
 *  updated (race / not found / no suggestion). */
export async function acceptPendingSuggestion(args: {
  mediaObjectId: string;
  ownerId: string;
}): Promise<AcceptSuggestionResult | null> {
  const updated = await db
    .update(mediaObjects)
    .set({
      folderId: sql`${mediaObjects.suggestedFolderId}`,
      suggestedFolderId: null,
      suggestedFolderAt: null,
    })
    .where(
      and(
        eq(mediaObjects.id, args.mediaObjectId),
        eq(mediaObjects.ownerId, args.ownerId),
        isNotNull(mediaObjects.suggestedFolderId)
      )
    )
    .returning({ folderId: mediaObjects.folderId });

  const folderId = updated[0]?.folderId;
  if (!folderId) return null;

  // Phase-1 dual-write to the join table. Suggestions only fire
  // for unfiled notes so there's typically nothing to clear, but
  // we wipe-and-insert defensively in case the note was filed via
  // a different path between the suggestion firing and the user
  // accepting it.
  await db
    .delete(mediaFolderAssignments)
    .where(
      and(
        eq(mediaFolderAssignments.mediaObjectId, args.mediaObjectId),
        eq(mediaFolderAssignments.ownerId, args.ownerId)
      )
    );
  await db
    .insert(mediaFolderAssignments)
    .values({
      mediaObjectId: args.mediaObjectId,
      folderId,
      ownerId: args.ownerId,
    })
    .onConflictDoNothing();

  const [folderRow] = await db
    .select({ name: folders.name })
    .from(folders)
    .where(eq(folders.id, folderId))
    .limit(1);

  return {
    folderId,
    folderName: folderRow?.name ?? "Unknown folder",
  };
}

/** Marks the suggestion dismissed: clears suggested_folder_id and stamps
 *  suggested_folder_dismissed_at = now(). Idempotent: calling on an
 *  already-dismissed row is a no-op. Returns true if the row exists and
 *  is owned by the caller, false otherwise (so the route can return 404
 *  on a foreign or missing id). */
export async function dismissSuggestion(args: {
  mediaObjectId: string;
  ownerId: string;
}): Promise<boolean> {
  const updated = await db
    .update(mediaObjects)
    .set({
      suggestedFolderId: null,
      suggestedFolderAt: null,
      suggestedFolderDismissedAt: new Date(),
    })
    .where(
      and(
        eq(mediaObjects.id, args.mediaObjectId),
        eq(mediaObjects.ownerId, args.ownerId)
      )
    )
    .returning({ id: mediaObjects.id });

  return updated.length > 0;
}

/** Best-effort touch — used so we know which mediaObjects table column we
 *  actually care about for the join above; keeps the import warning-free. */
const _ = notes;
void _;
