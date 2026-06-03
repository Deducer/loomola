import type { ParsedAttendee } from "./parse-attendees";

export interface PersonCandidate {
  id: string;
  displayName: string;
  email: string | null;
}

export type MatchConfidence = "high" | "medium" | "none";

export interface MatchResult {
  personId: string | null;
  confidence: MatchConfidence;
  reason: string;
}

/**
 * Match an incoming meeting attendee to one of the user's existing
 * `people` rows.
 *
 *   high  — explicit person id, or case-insensitive email exact match
 *   medium — full multi-token name match (every name token is shared,
 *            in any order; case- and punctuation-insensitive)
 *   none  — no reliable match
 *
 * Single-token name matches ("Sarah" alone) are deliberately rejected:
 * partial first names are too ambiguous for an auto-suggestion. The
 * caller can still create a new Person from the attendee data when
 * confidence is none.
 */
export function matchPerson(args: {
  candidates: ReadonlyArray<PersonCandidate>;
  attendee: ParsedAttendee;
}): MatchResult {
  const { candidates, attendee } = args;
  if (candidates.length === 0) {
    return { personId: null, confidence: "none", reason: "no_candidates" };
  }

  if (attendee.personId) {
    for (const c of candidates) {
      if (c.id === attendee.personId) {
        return {
          personId: c.id,
          confidence: "high",
          reason: "person_id_exact",
        };
      }
    }
  }

  // High: email match.
  if (attendee.email) {
    const target = attendee.email.toLowerCase();
    for (const c of candidates) {
      if (c.email && c.email.toLowerCase() === target) {
        return {
          personId: c.id,
          confidence: "high",
          reason: "email_exact",
        };
      }
    }
  }

  // Medium: full token-set name match.
  if (attendee.displayName) {
    const wantTokens = nameTokens(attendee.displayName);
    if (wantTokens.size >= 2) {
      for (const c of candidates) {
        const haveTokens = nameTokens(c.displayName);
        if (haveTokens.size < 2) continue;
        if (isTokenSetMatch(wantTokens, haveTokens)) {
          return {
            personId: c.id,
            confidence: "medium",
            reason: "name_token_match",
          };
        }
      }
    }
  }

  return { personId: null, confidence: "none", reason: "no_match" };
}

function nameTokens(name: string): Set<string> {
  return new Set(
    name
      .toLowerCase()
      .replace(/[.,()'"<>]/g, " ")
      .split(/\s+/)
      .filter(Boolean)
  );
}

function isTokenSetMatch(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0 || b.size === 0) return false;
  // All tokens of `a` must be present in `b` (or vice versa). i.e. one is
  // a subset of the other. This is symmetric and conservative.
  const small = a.size <= b.size ? a : b;
  const large = a.size <= b.size ? b : a;
  for (const token of small) {
    if (!large.has(token)) return false;
  }
  return true;
}
