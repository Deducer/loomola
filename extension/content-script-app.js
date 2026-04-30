/**
 * Content script that runs on loom.dissonance.cloud only.
 *
 * Bridges between the recording app's window-level postMessage events and
 * the extension's chrome.runtime messaging:
 *
 * - App → window.postMessage({ source: "loom-clone", type: "recording-started", ... })
 *     → forwarded to background as chrome.runtime.sendMessage
 *     → background tells all other tabs to show the bubble.
 *
 * - Captured tab posts a drag update through background → arrives here as
 *     chrome.tabs.sendMessage → we re-emit as window.postMessage so the
 *     recording app's main thread (which is in this same window) can pick it
 *     up and write into the BubblePositionController.
 */

(function () {
  console.log("[loom-clone-ext] content-script-app loaded on", location.href);

  // Synchronous marker on the document element so the React app can detect
  // the extension at any time without racing the message events. The
  // dataset attribute is visible across worlds because it's set on the
  // shared DOM (document.documentElement is the same element in the
  // isolated world and the page world).
  document.documentElement.dataset.loomCloneExtension = "1";

  /**
   * After extension reload, the orphan content script's chrome.runtime is
   * dead — any chrome.* call throws "Extension context invalidated"
   * synchronously. Defensive helpers so we never let those escape.
   */
  function isContextAlive() {
    try {
      return !!chrome?.runtime?.id;
    } catch {
      return false;
    }
  }

  function safeSendMessage(msg) {
    if (!isContextAlive()) return Promise.resolve(undefined);
    try {
      return chrome.runtime.sendMessage(msg).catch(() => undefined);
    } catch {
      return Promise.resolve(undefined);
    }
  }

  // App → background
  window.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || data.source !== "loom-clone") return;

    if (data.type === "recording-started") {
      console.log("[loom-clone-ext] recording-started", data);
      void safeSendMessage({
        type: "loom-clone:recording-started",
        bubbleShape: data.bubbleShape,
        bubbleSize: data.bubbleSize,
        bubbleMode: data.bubbleMode,
        bubblePosition: data.bubblePosition,
      });
    } else if (data.type === "recording-stopped") {
      console.log("[loom-clone-ext] recording-stopped");
      void safeSendMessage({ type: "loom-clone:recording-stopped" });
    } else if (data.type === "ping-extension") {
      // App is asking whether we're installed — respond directly.
      window.postMessage(
        { source: "loom-clone-extension", type: "installed" },
        window.location.origin
      );
    }
  });

  // Background → app (re-broadcast to the main window so the React tree
  // can listen via plain window.addEventListener("message", ...)).
  try {
    chrome.runtime.onMessage.addListener((msg) => {
      try {
        if (msg?.type === "loom-clone:bubble-position") {
          window.postMessage(
            {
              source: "loom-clone-extension",
              type: "bubble-position",
              position: msg.position,
            },
            "*"
          );
        }
      } catch {
        /* orphan callback after reload — silent */
      }
    });
  } catch {
    /* runtime already dead at script init — nothing to do */
  }

  // Broadcast "installed" on load — handles the case where the React app
  // is already listening when this script runs.
  window.postMessage(
    { source: "loom-clone-extension", type: "installed" },
    window.location.origin
  );
})();
