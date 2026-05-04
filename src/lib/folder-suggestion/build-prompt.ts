export interface SuggestionNoteInput {
  title: string;
  summary: string;
  transcriptExcerpt: string;
  attendeeNames: string[];
  sourceContextHint: string | null;
}

export interface SuggestionFolderInput {
  id: string;
  name: string;
  recentNoteTitles: string[];
}

const MAX_SUMMARY_CHARS = 1500;
const MAX_EXCERPT_HEAD = 500;
const MAX_EXCERPT_TAIL = 500;

function squashWhitespace(s: string): string {
  return s.replace(/[\r\n]+/g, " ").trim();
}

function trimSummary(summary: string): string {
  if (summary.length <= MAX_SUMMARY_CHARS) return summary;
  return summary.slice(0, MAX_SUMMARY_CHARS) + "…";
}

function trimExcerpt(excerpt: string): string {
  if (excerpt.length <= MAX_EXCERPT_HEAD + MAX_EXCERPT_TAIL) return excerpt;
  const head = excerpt.slice(0, MAX_EXCERPT_HEAD);
  const tail = excerpt.slice(excerpt.length - MAX_EXCERPT_TAIL);
  return `${head}\n…\n${tail}`;
}

/**
 * Builds the user-content prompt for the folder-suggestion classifier.
 * Pure function — deterministic, no I/O. The output is a single string
 * passed alongside the system instructions to Haiku via generateObject.
 */
export function buildFolderSuggestionPrompt(args: {
  note: SuggestionNoteInput;
  folders: SuggestionFolderInput[];
}): string {
  const { note, folders } = args;
  const lines: string[] = [];

  lines.push(
    "You categorize meeting notes into the user's existing folders. Pick"
  );
  lines.push(
    "the single folder that is the best fit, or return null if no folder"
  );
  lines.push(
    "is clearly the right home. Use 'high' confidence ONLY when you are"
  );
  lines.push(
    "sure — false matches feel worse than no match. Respond with JSON"
  );
  lines.push("matching the supplied schema. The folderId must come from the");
  lines.push("USER'S FOLDERS list below; do not invent folder ids.");
  lines.push("");

  lines.push("# NEW NOTE");
  lines.push(`Title: ${squashWhitespace(note.title)}`);
  if (note.sourceContextHint && note.sourceContextHint.trim()) {
    lines.push(`Source: ${squashWhitespace(note.sourceContextHint)}`);
  }
  if (note.attendeeNames.length > 0) {
    lines.push(`Attendees: ${note.attendeeNames.join(", ")}`);
  }
  lines.push("Summary:");
  lines.push(trimSummary(note.summary));
  lines.push("");
  lines.push("Transcript excerpt:");
  lines.push(trimExcerpt(note.transcriptExcerpt));
  lines.push("");

  lines.push("# USER'S FOLDERS");
  if (folders.length === 0) {
    lines.push("(none — return folderId: null)");
  } else {
    folders.forEach((f, i) => {
      const safeName = squashWhitespace(f.name);
      lines.push(`${i + 1}. ${f.id} — ${safeName}`);
      if (f.recentNoteTitles.length > 0) {
        const titles = f.recentNoteTitles
          .map((t) => `"${squashWhitespace(t)}"`)
          .join(", ");
        lines.push(`   Recent notes: ${titles}`);
      } else {
        lines.push("   Recent notes: (folder is empty)");
      }
    });
  }

  return lines.join("\n");
}
