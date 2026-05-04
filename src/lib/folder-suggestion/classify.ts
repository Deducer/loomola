import { folderSuggestionSchema, type FolderSuggestion } from "@/lib/ai/schemas";
import { generateObjectWithFallback } from "@/lib/ai/with-fallback";
import { getClassifierLlm } from "@/lib/ai/client";
import {
  buildFolderSuggestionPrompt,
  type SuggestionFolderInput,
  type SuggestionNoteInput,
} from "./build-prompt";

const SYSTEM = [
  "You are a precise classifier. Given a meeting note and a list of the",
  "user's existing folders, return JSON matching the supplied schema.",
  "Use 'high' confidence ONLY when the note clearly belongs to one specific",
  "folder. Use 'medium' or 'low' when ambiguous. Return folderId: null when",
  "no folder is clearly the right home. Never invent folder ids — every",
  "folderId must come from the provided list.",
].join(" ");

/**
 * Calls the classifier LLM to suggest a folder for the given note.
 * Returns the raw model response — gating happens in `acceptSuggestion`.
 */
export async function classifyFolder(args: {
  note: SuggestionNoteInput;
  folders: SuggestionFolderInput[];
}): Promise<FolderSuggestion> {
  const prompt = buildFolderSuggestionPrompt(args);
  const { object } = await generateObjectWithFallback({
    schema: folderSuggestionSchema,
    schemaName: "FolderSuggestion",
    model: getClassifierLlm(),
    maxOutputTokens: 500,
    prompt: `${SYSTEM}\n\n${prompt}`,
  });
  return object;
}

/**
 * Server-side gate: only accept the suggestion when the model is HIGH-
 * confident, named a non-null folder, AND that folder is one of the
 * user's actual folders (hallucination defense). Returns the folderId
 * when accepted, null otherwise.
 */
export function acceptSuggestion(
  response: FolderSuggestion,
  candidateFolderIds: ReadonlyArray<string>
): { folderId: string } | null {
  if (response.confidence !== "high") return null;
  if (response.folderId === null) return null;
  if (candidateFolderIds.length === 0) return null;
  if (!candidateFolderIds.includes(response.folderId)) return null;
  return { folderId: response.folderId };
}
