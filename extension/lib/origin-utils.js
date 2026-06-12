/**
 * Pure origin helpers for the configurable app origin — no chrome.* so the
 * web repo's Vitest suite can unit-test them directly
 * (tests/unit/extension-origin-utils.test.ts).
 */

export const DEFAULT_APP_ORIGIN = "https://loom.dissonance.cloud";

function isLoopbackHost(hostname) {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname.endsWith(".localhost")
  );
}

/**
 * Normalizes user input ("my-loomola.com", "https://x.com/record ") to a
 * bare origin, or null when unusable. http is allowed for loopback hosts
 * only — everything else must be https (the recorder needs a secure
 * context anyway).
 */
export function normalizeAppOrigin(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let url;
  try {
    url = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
    );
  } catch {
    return null;
  }
  if (url.protocol === "https:") return url.origin;
  if (url.protocol === "http:" && isLoopbackHost(url.hostname)) {
    return url.origin;
  }
  return null;
}

/**
 * Chrome match patterns (used by both scripting.registerContentScripts and
 * tabs.query({url})) may NOT contain ports — a pattern matches the host on
 * any port. Strip the port; keep the full origin for display/links.
 */
export function originToMatchPattern(origin) {
  const url = new URL(origin);
  return `${url.protocol}//${url.hostname}/*`;
}
