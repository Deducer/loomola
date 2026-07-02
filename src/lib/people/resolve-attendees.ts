export type CalendarAttendeeInput = {
  displayName: string;
  email?: string | null;
};

/**
 * Normalizes a raw calendar-attendee list before person resolution:
 * trims, drops entries with no usable name or email, dedupes by lowercase
 * email first (same human, differently-cased address) and then by
 * lowercase display name for email-less entries. Order preserved.
 * Pure — the DB matching lives in the /api/people/resolve route.
 */
export function normalizeCalendarAttendees(
  input: CalendarAttendeeInput[]
): { displayName: string; email: string | null }[] {
  const seenEmails = new Set<string>();
  const seenNames = new Set<string>();
  const out: { displayName: string; email: string | null }[] = [];

  for (const raw of input) {
    const email = raw.email?.trim().toLowerCase() || null;
    let displayName = raw.displayName?.trim() ?? "";
    if (!displayName && email) {
      // Invites often carry a bare address; the local part beats "Unknown".
      displayName = email.split("@")[0];
    }
    if (!displayName) continue;

    if (email) {
      if (seenEmails.has(email)) continue;
      seenEmails.add(email);
    } else {
      const nameKey = displayName.toLowerCase();
      if (seenNames.has(nameKey)) continue;
      seenNames.add(nameKey);
    }
    out.push({ displayName, email });
  }
  return out;
}
