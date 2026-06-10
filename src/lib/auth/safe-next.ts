/**
 * Validates that a redirect path from a query string is same-origin before use.
 * Blocks open-redirect tricks like //evil.com and /\evil.com.
 */
export function safeNextPath(raw: string | null): string {
  if (!raw) return "/";
  // Must start with "/" but not "//" or "/\"
  if (raw.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/\\")) {
    return raw;
  }
  return "/";
}
