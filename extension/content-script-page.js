/**
 * Content script that runs on every URL except loom.dissonance.cloud.
 *
 * Receives "show-bubble" / "hide-bubble" messages from the background
 * service worker and injects an iframe pointing at
 * https://loom.dissonance.cloud/bubble. The iframe (loom-clone origin) has
 * camera permission and renders the live frameless circle.
 *
 * Drag events bubble up from the iframe via cross-origin postMessage; we
 * forward them to the background so they reach the recording app's tab.
 */

const IFRAME_ID = "__loom_clone_bubble_iframe__";
const IFRAME_SIZE_PX = {
  small: 160,
  medium: 220,
  large: 280,
};

function ensureIframe(state) {
  let iframe = document.getElementById(IFRAME_ID);
  if (iframe) return iframe;

  iframe = document.createElement("iframe");
  iframe.id = IFRAME_ID;
  iframe.src = `https://loom.dissonance.cloud/bubble?shape=${encodeURIComponent(
    state.bubbleShape ?? "circle"
  )}&size=${encodeURIComponent(state.bubbleSize ?? "medium")}`;
  iframe.allow = "camera; microphone";

  const sizePx = IFRAME_SIZE_PX[state.bubbleSize ?? "medium"];
  Object.assign(iframe.style, {
    position: "fixed",
    bottom: "32px",
    right: "32px",
    width: `${sizePx}px`,
    height: `${sizePx}px`,
    border: "none",
    background: "transparent",
    zIndex: "2147483647", // top of stacking context
    pointerEvents: "auto",
    colorScheme: "normal",
  });
  iframe.setAttribute("aria-label", "Loom Clone camera bubble");
  document.documentElement.appendChild(iframe);
  return iframe;
}

function removeIframe() {
  const iframe = document.getElementById(IFRAME_ID);
  if (iframe) iframe.remove();
}

console.log("[loom-clone-ext] content-script-page loaded on", location.href);

/**
 * After the extension is reloaded at chrome://extensions, Chrome stops the
 * old content script's runtime but does NOT re-inject the new script into
 * already-open tabs — the orphan script keeps running with a dead
 * `chrome.runtime` and any chrome.* call throws "Extension context
 * invalidated" synchronously. Wrap EVERY chrome.* access (sendMessage,
 * onMessage.addListener, runtime.id check) in try/catch so the orphan
 * fails silently instead of spamming the console.
 */
function isContextAlive() {
  try {
    return !!chrome?.runtime?.id;
  } catch {
    return false;
  }
}

function safeSendMessage(msg) {
  if (!isContextAlive()) {
    removeIframe();
    return Promise.resolve(undefined);
  }
  try {
    return chrome.runtime.sendMessage(msg).catch(() => undefined);
  } catch {
    removeIframe();
    return Promise.resolve(undefined);
  }
}

try {
  chrome.runtime.onMessage.addListener((msg) => {
    try {
      if (msg?.type === "loom-clone:show-bubble") {
        console.log("[loom-clone-ext] show-bubble", msg.state);
        ensureIframe(msg.state ?? {});
      } else if (msg?.type === "loom-clone:hide-bubble") {
        console.log("[loom-clone-ext] hide-bubble");
        removeIframe();
      }
    } catch {
      /* orphan callback after reload — silent */
    }
  });
} catch {
  /* runtime already dead at script init — nothing more to do */
}

// On script load, ask the background if a recording is currently in progress.
void safeSendMessage({ type: "loom-clone:get-state" }).then((response) => {
  if (response?.state) ensureIframe(response.state);
});

/**
 * Drag handling lives here in the parent because the iframe's own pointer
 * events stop firing the moment the cursor leaves the iframe — leading to
 * "drags from far away" feeling stuck or jumping. The iframe just signals
 * "drag-start" and we take over with document-level mousemove/mouseup,
 * which keep firing regardless of where the cursor moves.
 */
let dragState = null;

function onDragMove(e) {
  if (!dragState) return;
  const iframe = document.getElementById(IFRAME_ID);
  if (!iframe) return;
  if (!dragState.anchored) {
    dragState.startMouseX = e.clientX;
    dragState.startMouseY = e.clientY;
    dragState.anchored = true;
  }
  const dx = e.clientX - dragState.startMouseX;
  const dy = e.clientY - dragState.startMouseY;
  iframe.style.left = `${dragState.startIframeLeft + dx}px`;
  iframe.style.top = `${dragState.startIframeTop + dy}px`;
  iframe.style.right = "auto";
  iframe.style.bottom = "auto";
}

function onDragEnd() {
  document.removeEventListener("mousemove", onDragMove, true);
  document.removeEventListener("mouseup", onDragEnd, true);
  if (!dragState) return;
  const iframe = document.getElementById(IFRAME_ID);
  if (iframe) {
    const rect = iframe.getBoundingClientRect();
    const viewportW = window.innerWidth || 1920;
    const viewportH = window.innerHeight || 1080;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const fracX = Math.min(1, Math.max(0, cx / viewportW));
    const fracY = Math.min(1, Math.max(0, cy / viewportH));
    void safeSendMessage({
      type: "loom-clone:bubble-drag",
      position: { x: fracX, y: fracY },
    });
  }
  dragState = null;
}

window.addEventListener("message", (event) => {
  if (event.origin !== "https://loom.dissonance.cloud") return;
  const data = event.data;
  if (!data || data.source !== "loom-clone-bubble") return;

  if (data.type === "drag-start") {
    const iframe = document.getElementById(IFRAME_ID);
    if (!iframe) return;
    const rect = iframe.getBoundingClientRect();
    dragState = {
      anchored: false,
      startMouseX: 0,
      startMouseY: 0,
      startIframeLeft: rect.left,
      startIframeTop: rect.top,
    };
    document.addEventListener("mousemove", onDragMove, true);
    document.addEventListener("mouseup", onDragEnd, true);
  }
});
