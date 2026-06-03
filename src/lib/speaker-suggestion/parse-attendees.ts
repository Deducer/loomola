export interface ParsedAttendee {
  personId?: string | null;
  displayName: string | null;
  email: string | null;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Parses the loose JSONB shape of `media_objects.attendees` into a
 * normalized list. Accepts arrays of person UUID strings, legacy display
 * strings, objects with `id`/`personId`, `name`/`displayName`, and/or
 * `email`, or mixed. Emails are lowercased + trimmed; names are trimmed.
 * Entries with neither a person id, name, nor email are dropped.
 * De-duplicated by person id first, then lowercased email.
 */
export function parseAttendees(raw: unknown): ParsedAttendee[] {
  if (!Array.isArray(raw)) return [];

  const seenPersonIds = new Set<string>();
  const seenEmails = new Set<string>();
  const result: ParsedAttendee[] = [];

  for (const entry of raw) {
    const parsed = parseEntry(entry);
    if (!parsed) continue;
    if (parsed.personId) {
      if (seenPersonIds.has(parsed.personId)) continue;
      seenPersonIds.add(parsed.personId);
    }
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
    const value = entry.trim();
    if (!value) return null;
    if (UUID_RE.test(value)) {
      return { personId: value, displayName: null, email: null };
    }
    return { displayName: value, email: null };
  }
  if (entry && typeof entry === "object") {
    const o = entry as Record<string, unknown>;
    const rawPersonId =
      (typeof o.personId === "string" && o.personId) ||
      (typeof o.id === "string" && o.id) ||
      "";
    const rawName =
      (typeof o.displayName === "string" && o.displayName) ||
      (typeof o.name === "string" && o.name) ||
      "";
    const rawEmail = typeof o.email === "string" ? o.email : "";
    const personId = rawPersonId.trim();
    const name = rawName.trim();
    const email = rawEmail.trim().toLowerCase();
    if (!UUID_RE.test(personId) && !name && !email) return null;
    return {
      ...(UUID_RE.test(personId) ? { personId } : {}),
      displayName: name || null,
      email: email || null,
    };
  }
  return null;
}
