/**
 * Background service worker — message router between the loom-clone tab and
 * captured tabs.
 *
 * Manifest v3 service workers get killed after ~30s idle, so we persist the
 * "recording session" state in chrome.storage rather than module variables.
 */

const STATE_KEY = "loomCloneRecordingState";

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

/**
 * Inject the bubble into a tab by sending its content script a "show" message.
 * If the content script isn't loaded (the tab was open before the extension
 * was installed / reloaded), inject it programmatically first via
 * chrome.scripting, then send the message.
 */
async function broadcastShowBubble(state) {
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs.map(async (tab) => {
      if (!tab.id || !tab.url) return;
      if (tab.url.startsWith("https://loom.dissonance.cloud")) return;
      // chrome:// and similar pages are off-limits for extensions.
      if (
        tab.url.startsWith("chrome://") ||
        tab.url.startsWith("chrome-extension://") ||
        tab.url.startsWith("edge://") ||
        tab.url.startsWith("about:")
      ) {
        return;
      }
      try {
        await chrome.tabs.sendMessage(tab.id, {
          type: "loom-clone:show-bubble",
          state,
        });
      } catch {
        // No content script in this tab — likely opened before the extension
        // was installed/reloaded. Inject programmatically and retry.
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ["content-script-page.js"],
          });
          await chrome.tabs.sendMessage(tab.id, {
            type: "loom-clone:show-bubble",
            state,
          });
          console.log(
            `[loom-clone-ext:bg] injected content-script into tab ${tab.id}`
          );
        } catch (err) {
          console.warn(
            `[loom-clone-ext:bg] couldn't inject into tab ${tab.id}:`,
            err
          );
        }
      }
    })
  );
}

async function broadcastHideBubble() {
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs.map(async (tab) => {
      if (!tab.id) return;
      try {
        await chrome.tabs.sendMessage(tab.id, { type: "loom-clone:hide-bubble" });
      } catch {
        // ignore
      }
    })
  );
}

/**
 * Forward a position update from any tab back to the loom-clone tab so the
 * recording app can update its BubblePositionController.
 */
async function forwardPositionToApp(position) {
  const tabs = await chrome.tabs.query({
    url: "https://loom.dissonance.cloud/*",
  });
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

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  console.log("[loom-clone-ext:bg] received", msg?.type);
  // Async handlers must return true and call sendResponse later.
  (async () => {
    try {
      if (msg?.type === "loom-clone:recording-started") {
        const state = {
          startedAt: Date.now(),
          bubbleShape: msg.bubbleShape ?? "circle",
          bubbleSize: msg.bubbleSize ?? "medium",
        };
        await writeState(state);
        await broadcastShowBubble(state);
        sendResponse({ ok: true });
      } else if (msg?.type === "loom-clone:recording-stopped") {
        await writeState(null);
        await broadcastHideBubble();
        sendResponse({ ok: true });
      } else if (msg?.type === "loom-clone:bubble-drag") {
        await forwardPositionToApp(msg.position);
        sendResponse({ ok: true });
      } else if (msg?.type === "loom-clone:get-state") {
        const state = await readState();
        sendResponse({ ok: true, state });
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
  if (tab.url && tab.url.startsWith("https://loom.dissonance.cloud")) return;
  const state = await readState();
  if (!state) return;
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: "loom-clone:show-bubble",
      state,
    });
  } catch {
    // ignore — content script may not be live on this URL
  }
});
