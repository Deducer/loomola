export interface ParsedAttendee {
  displayName: string | null;
  email: string | null;
}

/**
 * Parses the loose JSONB shape of `media_objects.attendees` into a
 * normalized list. Accepts arrays of strings (display name only),
 * objects with `name`/`displayName` and/or `email`, or mixed. Emails
 * are lowercased + trimmed; names are trimmed. Entries with neither a
 * name nor an email are dropped. De-duplicated by lowercased email.
 */
export function parseAttendees(raw: unknown): ParsedAttendee[] {
  if (!Array.isArray(raw)) return [];

  const seenEmails = new Set<string>();
  const result: ParsedAttendee[] = [];

  for (const entry of raw) {
    const parsed = parseEntry(entry);
    if (!parsed) continue;
    if (parsed.email) {
      if (seenEmails.has(parsed.email)) continue;
      seenEmails.add(parsed.email);
    }
    result.push(parsed);
  }

  return result;
}

function parseEntry(entry: unknown): ParsedAttendee | null {
  if (typeof entry === "string") {
    const name = entry.trim();
    if (!name) return null;
    return { displayName: name, email: null };
  }
  if (entry && typeof entry === "object") {
    const o = entry as Record<string, unknown>;
    const rawName =
      (typeof o.displayName === "string" && o.displayName) ||
      (typeof o.name === "string" && o.name) ||
      "";
    const rawEmail = typeof o.email === "string" ? o.email : "";
    const name = rawName.trim();
    const email = rawEmail.trim().toLowerCase();
    if (!name && !email) return null;
    return {
      displayName: name || null,
      email: email || null,
    };
  }
  return null;
}
