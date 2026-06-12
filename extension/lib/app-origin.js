/**
 * chrome.storage.sync-backed app-origin accessors. Used by the background
 * service worker, the options page, and the popup (all ES-module contexts).
 * Content scripts never need this — they're gated by where they're
 * registered, not by reading the origin themselves.
 */
import { DEFAULT_APP_ORIGIN, normalizeAppOrigin } from "./origin-utils.js";

export const APP_ORIGIN_STORAGE_KEY = "appOrigin";

/** Resolved origin: stored value when valid, else the default. Never throws. */
export async function getAppOrigin() {
  try {
    const result = await chrome.storage.sync.get(APP_ORIGIN_STORAGE_KEY);
    return normalizeAppOrigin(result[APP_ORIGIN_STORAGE_KEY]) ?? DEFAULT_APP_ORIGIN;
  } catch {
    return DEFAULT_APP_ORIGIN;
  }
}

/** Whether the user has ever set an origin (drives the first-run prompt). */
export async function hasStoredAppOrigin() {
  try {
    const result = await chrome.storage.sync.get(APP_ORIGIN_STORAGE_KEY);
    return typeof result[APP_ORIGIN_STORAGE_KEY] === "string";
  } catch {
    return false;
  }
}

/** Normalizes and stores; throws on invalid input (callers show the error). */
export async function setAppOrigin(raw) {
  const normalized = normalizeAppOrigin(raw);
  if (!normalized) {
    throw new Error(
      "Enter your Loomola URL, e.g. https://loomola.example.com (http allowed for localhost only)."
    );
  }
  await chrome.storage.sync.set({ [APP_ORIGIN_STORAGE_KEY]: normalized });
  return normalized;
}

/** Clears the stored origin — back to the default instance. */
export async function clearAppOrigin() {
  await chrome.storage.sync.remove(APP_ORIGIN_STORAGE_KEY);
}

export { DEFAULT_APP_ORIGIN };
