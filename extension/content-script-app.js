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
  // App → background
  window.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || data.source !== "loom-clone") return;

    if (data.type === "recording-started") {
      chrome.runtime.sendMessage({
        type: "loom-clone:recording-started",
        bubbleShape: data.bubbleShape,
        bubbleSize: data.bubbleSize,
      });
    } else if (data.type === "recording-stopped") {
      chrome.runtime.sendMessage({ type: "loom-clone:recording-stopped" });
    }
  });

  // Background → app (re-broadcast to the main window so the React tree
  // can listen via plain window.addEventListener("message", ...)).
  chrome.runtime.onMessage.addListener((msg) => {
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
  });

  // Tell the page that the extension is installed so the app can hide the
  // docPiP fallback.
  window.postMessage(
    { source: "loom-clone-extension", type: "installed" },
    window.location.origin
  );
})();
