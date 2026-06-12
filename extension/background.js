/**
 * Background service worker — message router between the loom-clone tab and
 * captured tabs.
 *
 * Manifest v3 service workers get killed after ~30s idle, so we persist the
 * "recording session" state in chrome.storage rather than module variables.
 */

import { getAppOrigin, DEFAULT_APP_ORIGIN } from "./lib/app-origin.js";
import { originToMatchPattern } from "./lib/origin-utils.js";

/** Id for the dynamically-registered app-bridge content script (used only
 * when a non-default origin is configured; the static manifest entry covers
 * the default origin). */
const APP_SCRIPT_ID = "loomola-app-bridge";

async function appUrlPattern() {
  return originToMatchPattern(await getAppOrigin());
}

/**
 * Keeps the dynamic registration of content-script-app.js in sync with the
 * configured origin. Default origin → no dynamic script (the static
 * manifest entry already covers it — zero behavior change for the default
 * install). Custom origin → register/update the bridge for that origin.
 * Authorized by the manifest's required <all_urls> host permission, so no
 * chrome.permissions.request flow is needed. persistAcrossSessions keeps
 * the registration across browser restarts; onStartup/onInstalled re-syncs
 * are self-healing belt-and-braces.
 */
async function syncAppContentScript() {
  try {
    const origin = await getAppOrigin();
    const existing = await chrome.scripting.getRegisteredContentScripts({
      ids: [APP_SCRIPT_ID],
    });
    if (origin === DEFAULT_APP_ORIGIN) {
      if (existing.length > 0) {
        await chrome.scripting.unregisterContentScripts({ ids: [APP_SCRIPT_ID] });
        console.log("[loom-clone-ext:bg] app bridge back on default origin");
      }
      return;
    }
    const script = {
      id: APP_SCRIPT_ID,
      matches: [originToMatchPattern(origin)],
      js: ["content-script-app.js"],
      runAt: "document_idle",
      persistAcrossSessions: true,
    };
    if (existing.length > 0) {
      await chrome.scripting.updateContentScripts([script]);
    } else {
      await chrome.scripting.registerContentScripts([script]);
    }
    console.log(`[loom-clone-ext:bg] app bridge registered for ${origin}`);
  } catch (err) {
    console.error("[loom-clone-ext:bg] syncAppContentScript failed:", err);
  }
}

chrome.runtime.onInstalled.addListener(() => void syncAppContentScript());
chrome.runtime.onStartup.addListener(() => void syncAppContentScript());
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.appOrigin) void syncAppContentScript();
});

const STATE_KEY = "loomCloneRecordingState";
const MEETING_SIGNAL_KEY = "loomCloneMeetingSignal";
const NATIVE_HOST_NAME = "com.dissonance.loom_desktop";

async function readState() {
  const result = await chrome.storage.session.get(STATE_KEY);
  return result[STATE_KEY] ?? null;
}

async function writeState(value) {
  if (value === null) {
    await chrome.storage.session.remove(STATE_KEY);
  } else {
    await chrome.storage.session.set({ [STATE_KEY]: value });
  }
}

async function readMeetingSignal() {
  const result = await chrome.storage.session.get(MEETING_SIGNAL_KEY);
  return result[MEETING_SIGNAL_KEY] ?? null;
}

async function writeMeetingSignal(value) {
  if (value === null) {
    await chrome.storage.session.remove(MEETING_SIGNAL_KEY);
  } else {
    await chrome.storage.session.set({ [MEETING_SIGNAL_KEY]: value });
  }
}

const ACTIVE_TAB_KEY = "loomCloneActiveBubbleTabId";

async function readActiveBubbleTabId() {
  const r = await chrome.storage.session.get(ACTIVE_TAB_KEY);
  return r[ACTIVE_TAB_KEY] ?? null;
}

async function writeActiveBubbleTabId(tabId) {
  if (tabId === null) {
    await chrome.storage.session.remove(ACTIVE_TAB_KEY);
  } else {
    await chrome.storage.session.set({ [ACTIVE_TAB_KEY]: tabId });
  }
}

/**
 * Whether a tab is one we can or should inject the bubble into.
 * The Loomola app origin is intentionally allowed: in entire-screen
 * recording mode the user often stays on /record, and without the
 * bubble injected there they'd see no bubble at all until they
 * switched tabs. The /record HUD's own camera preview coexists with
 * the floating bubble overlay. Excludes only the chrome://-style URLs
 * that extensions can't touch.
 */
function isInjectableTab(tab) {
  if (!tab?.id || !tab.url) return false;
  if (
    tab.url.startsWith("chrome://") ||
    tab.url.startsWith("chrome-extension://") ||
    tab.url.startsWith("edge://") ||
    tab.url.startsWith("about:")
  ) {
    return false;
  }
  return true;
}

async function showBubbleInTab(tabId, state) {
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: "loom-clone:show-bubble",
      state,
    });
  } catch {
    // Content script not loaded yet (tab was open before extension was
    // installed / reloaded). Inject programmatically then resend.
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content-script-page.js"],
      });
      await chrome.tabs.sendMessage(tabId, {
        type: "loom-clone:show-bubble",
        state,
      });
      console.log(
        `[loom-clone-ext:bg] injected content-script into tab ${tabId}`
      );
    } catch (err) {
      console.warn(
        `[loom-clone-ext:bg] couldn't inject into tab ${tabId}:`,
        err
      );
    }
  }
}

async function hideBubbleInTab(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "loom-clone:hide-bubble" });
  } catch {
    /* ignore */
  }
}

/**
 * Show the bubble in the currently-active tab only. We can't reliably know
 * which tab the user picked in the share-picker (Chrome doesn't expose that
 * mapping), so the model is "follow the active tab" — bubble appears in
 * whichever tab the user is currently viewing. When they switch to the tab
 * they're presenting from, the bubble follows them and ends up in the
 * recording naturally.
 */
async function broadcastShowBubble(state) {
  const [activeTab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  if (!isInjectableTab(activeTab)) {
    console.log(
      "[loom-clone-ext:bg] active tab is not injectable; skipping for now"
    );
    return;
  }
  await showBubbleInTab(activeTab.id, state);
  await writeActiveBubbleTabId(activeTab.id);
}

async function broadcastHideBubble() {
  // Sweep every tab — some may have stale bubbles if the user switched
  // around during recording.
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs.map((tab) => (tab.id ? hideBubbleInTab(tab.id) : null))
  );
  await writeActiveBubbleTabId(null);
}

// As the user switches tabs during recording, move the bubble with them so
// it lands in whichever tab they end up presenting from.
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const state = await readState();
  if (!state) return;
  // docPiP mode: /record owns the bubble in a system-level window,
  // so don't shuttle iframes between tabs — that would show a
  // second bubble in Chrome contexts.
  if (state.bubbleMode === "docpip") return;
  const previous = await readActiveBubbleTabId();
  if (previous !== null && previous !== tabId) {
    await hideBubbleInTab(previous);
  }
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!isInjectableTab(tab)) {
    await writeActiveBubbleTabId(null);
    return;
  }
  await showBubbleInTab(tabId, state);
  await writeActiveBubbleTabId(tabId);
});

/**
 * Forward a position update from any tab back to the loom-clone tab so the
 * recording app can update its BubblePositionController.
 */
async function forwardPositionToApp(position) {
  const tabs = await chrome.tabs.query({ url: await appUrlPattern() });
  await Promise.all(
    tabs.map(async (tab) => {
      if (!tab.id) return;
      try {
        await chrome.tabs.sendMessage(tab.id, {
          type: "loom-clone:bubble-position",
          position,
        });
      } catch {
        // ignore
      }
    })
  );
}

async function forwardMeetingSignalToApp(meeting) {
  const tabs = await chrome.tabs.query({ url: await appUrlPattern() });
  await Promise.all(
    tabs.map(async (tab) => {
      if (!tab.id) return;
      try {
        await chrome.tabs.sendMessage(tab.id, {
          type: "loom-clone:meeting-active",
          meeting,
        });
      } catch {
        // ignore
      }
    })
  );
}

async function forwardMeetingSignalToNativeHost(meeting) {
  try {
    await chrome.runtime.sendNativeMessage(NATIVE_HOST_NAME, {
      event: "meeting-active",
      source: meeting.source,
      title: meeting.title,
      tabUrl: meeting.tabUrl,
      ts: meeting.ts,
    });
  } catch {
    // Native host is optional during local development.
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  console.log("[loom-clone-ext:bg] received", msg?.type);
  // Async handlers must return true and call sendResponse later.
  (async () => {
    try {
      if (msg?.type === "loom-clone:recording-started") {
        const state = {
          startedAt: Date.now(),
          bubbleShape: msg.bubbleShape ?? "circle",
          bubbleSize: msg.bubbleSize ?? "medium",
          // Fractional (0..1) center position. Persisted across tab
          // switches so the iframe re-injected on a new tab spawns at
          // the user's last-dragged position instead of bottom-right.
          position: msg.bubblePosition ?? null,
          // "iframe" (default): inject the in-tab bubble on every
          // captured Chrome tab. "docpip": /record is rendering its
          // own Document-Picture-in-Picture window, so DON'T inject
          // — otherwise the user sees two bubbles on Chrome tabs
          // (one in the iframe, one in the docPiP overlay).
          bubbleMode: msg.bubbleMode === "docpip" ? "docpip" : "iframe",
        };
        await writeState(state);
        if (state.bubbleMode !== "docpip") {
          await broadcastShowBubble(state);
        }
        sendResponse({ ok: true });
      } else if (msg?.type === "loom-clone:recording-stopped") {
        await writeState(null);
        await broadcastHideBubble();
        sendResponse({ ok: true });
      } else if (msg?.type === "loom-clone:bubble-drag") {
        // Persist the dragged position so the next tab the user activates
        // gets an iframe that spawns at the same fractional location.
        const cur = await readState();
        if (cur) {
          cur.position = msg.position;
          await writeState(cur);
        }
        await forwardPositionToApp(msg.position);
        sendResponse({ ok: true });
      } else if (msg?.type === "loom-clone:bubble-size") {
        // User picked a new size from the in-bubble toolbar — persist
        // it so subsequent ensureIframe calls (tab switches, fresh
        // injects) honor the choice.
        const cur = await readState();
        if (cur && typeof msg.size === "string") {
          cur.bubbleSize = msg.size;
          await writeState(cur);
        }
        sendResponse({ ok: true });
      } else if (msg?.type === "loom-clone:meeting-active") {
        const meeting = {
          source: msg.meeting?.source,
          title: msg.meeting?.title ?? null,
          tabUrl: msg.meeting?.tabUrl ?? sender.tab?.url ?? null,
          ts: typeof msg.meeting?.ts === "number" ? msg.meeting.ts : Date.now(),
          tabId: sender.tab?.id ?? null,
          receivedAt: Date.now(),
        };
        await writeMeetingSignal(meeting);
        await forwardMeetingSignalToApp(meeting);
        await forwardMeetingSignalToNativeHost(meeting);
        sendResponse({ ok: true, meeting });
      } else if (msg?.type === "loom-clone:get-state") {
        const state = await readState();
        sendResponse({ ok: true, state });
      } else if (msg?.type === "loom-clone:get-meeting-signal") {
        const meeting = await readMeetingSignal();
        sendResponse({ ok: true, meeting });
      } else {
        sendResponse({ ok: false, error: "unknown message type" });
      }
    } catch (err) {
      console.error("[loom-clone:bg]", err);
      sendResponse({ ok: false, error: String(err) });
    }
  })();
  return true; // async response
});

/**
 * When a new tab finishes loading, check if a recording is in progress and
 * inject the bubble. Handles tabs opened mid-recording.
 */
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  if (!isInjectableTab(tab)) return;
  const state = await readState();
  if (!state) return;
  if (state.bubbleMode === "docpip") return;
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: "loom-clone:show-bubble",
      state,
    });
  } catch {
    // ignore — content script may not be live on this URL
  }
});
