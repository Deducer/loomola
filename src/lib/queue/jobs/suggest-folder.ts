import {
  getNoteForSuggestion,
  getCandidateFolders,
  persistSuggestion,
} from "@/db/queries/folder-suggestion";
import {
  classifyFolder,
  acceptSuggestion,
} from "@/lib/folder-suggestion/classify";

export const SUGGEST_FOLDER_JOB = "suggest_folder";

export type SuggestFolderJobData = { mediaObjectId: string };

const MIN_TRANSCRIPT_CHARS = 200;

/**
 * Picks a folder for a freshly-processed note when the user hasn't already
 * filed it manually. Runs after `generate_title_summary` so we have a
 * decent summary to feed the classifier. All early-return paths log a
 * single line so post-mortem is easy.
 */
export async function runSuggestFolderJob(
  data: SuggestFolderJobData
): Promise<void> {
  const { mediaObjectId } = data;
  const note = await getNoteForSuggestion(mediaObjectId);
  if (!note) {
    console.log(`[suggest-folder] ${mediaObjectId} not found, skipping`);
    return;
  }

  if (note.folderId !== null) {
    console.log(
      `[suggest-folder] ${mediaObjectId} already has folder, skipping`
    );
    return;
  }

  if (note.suggestedFolderId !== null) {
    console.log(
      `[suggest-folder] ${mediaObjectId} already has a pending suggestion, skipping`
    );
    return;
  }

  // Dismissal stickiness: a previous suggestion was rejected. Only resuggest
  // if the AI was regenerated AFTER the dismissal — that means the user
  // clicked "Regenerate notes" and we get one more shot at a fresh suggestion.
  if (
    note.suggestedFolderDismissedAt !== null &&
    (note.aiUpdatedAt === null ||
      note.aiUpdatedAt <= note.suggestedFolderDismissedAt)
  ) {
    console.log(
      `[suggest-folder] ${mediaObjectId} previously dismissed and AI not regenerated since; skipping`
    );
    return;
  }

  const summaryLen = note.input.summary.trim().length;
  const transcriptLen = note.input.transcriptExcerpt.trim().length;
  if (summaryLen === 0 && transcriptLen < MIN_TRANSCRIPT_CHARS) {
    console.log(
      `[suggest-folder] ${mediaObjectId} too thin (summary=${summaryLen}, transcript=${transcriptLen}); skipping`
    );
    return;
  }

  const folders = await getCandidateFolders(note.ownerId);
  if (folders.length === 0) {
    console.log(
      `[suggest-folder] ${mediaObjectId} owner has no folders; skipping`
    );
    return;
  }

  const response = await classifyFolder({
    note: note.input,
    folders,
  });

  const candidateIds = folders.map((f) => f.id);
  const accepted = acceptSuggestion(response, candidateIds);
  if (!accepted) {
    console.log(
      `[suggest-folder] ${mediaObjectId} no accepted match (confidence=${response.confidence}, folderId=${response.folderId ?? "null"})`
    );
    return;
  }

  await persistSuggestion({
    mediaObjectId,
    folderId: accepted.folderId,
  });

  console.log(
    `[suggest-folder] ${mediaObjectId} → ${accepted.folderId} (confidence=high)`
  );
}
