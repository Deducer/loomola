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
  console.log(
    "[loom-clone-ext] iframe injected on",
    location.href,
    "size",
    sizePx
  );
  return iframe;
}

function removeIframe() {
  const iframe = document.getElementById(IFRAME_ID);
  if (iframe) iframe.remove();
}

console.log(
  "[loom-clone-ext v0.2.0] content-script-page loaded on",
  location.href
);

/**
 * The manifest now matches every URL including loom.dissonance.cloud,
 * which means this script also runs inside the /bubble iframe itself.
 * Without this guard we'd recursively inject another bubble iframe
 * inside the bubble document. Top-level frames only.
 */
const IS_TOP_FRAME = window.top === window;

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
  // After an extension reload, the orphan content script keeps running but
  // its chrome.runtime is dead. Earlier this also called removeIframe() on
  // failure as a "cleanup" — but when the new script and the orphan both
  // run side-by-side (Chrome injects the new one without unloading the
  // orphan), every drag-end fired the orphan's safeSendMessage, which
  // promptly destroyed the iframe the new script was managing. Now we
  // just no-op when the context is dead and let the new script own the
  // iframe lifecycle entirely.
  if (!isContextAlive()) return Promise.resolve(undefined);
  try {
    return chrome.runtime.sendMessage(msg).catch(() => undefined);
  } catch {
    return Promise.resolve(undefined);
  }
}

if (IS_TOP_FRAME) {
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
}

/**
 * Drag architecture (third time's the charm):
 *
 * On drag-start from the iframe, we flip the iframe's pointer-events to
 * "none". That makes the iframe rectangle physically transparent to
 * mouse events — every mousemove and mouseup fires on the parent's
 * document, even when the cursor is over the (visually-rendered) bubble.
 * The parent owns the entire pointer stream for the duration of the
 * drag, which means:
 *
 *   - No choppiness: every pixel of cursor motion produces a mousemove
 *     here, not just the ones where the cursor escaped the iframe.
 *   - mouseup ends the drag deterministically. No more "drag survives
 *     the button release" because of cross-iframe pointer capture quirks.
 *
 * Stick-to-cursor math: at drag-start the iframe sends offsetX/offsetY,
 * which is where on the iframe the user clicked. We position the iframe
 * via (cursor - offset) on every mousemove, so the click point stays
 * pinned under the cursor.
 *
 * The drag-end-from-iframe path is a safety net for fast click-release:
 * postMessage is async, so for ~one frame after drag-start the iframe
 * is still pointer-events: auto. If the user releases inside that
 * window, mouseup goes to the iframe (not the parent's document) and
 * the iframe forwards drag-end-from-iframe so we don't get stuck.
 */
let dragState = null;

function onDragMove(e) {
  if (!dragState) return;
  const iframe = document.getElementById(IFRAME_ID);
  if (!iframe) return;
  iframe.style.left = `${e.clientX - dragState.offsetX}px`;
  iframe.style.top = `${e.clientY - dragState.offsetY}px`;
  iframe.style.right = "auto";
  iframe.style.bottom = "auto";
}

function endDrag() {
  if (!dragState) return;
  document.removeEventListener("mousemove", onDragMove, true);
  document.removeEventListener("mouseup", endDrag, true);
  const iframe = document.getElementById(IFRAME_ID);
  if (iframe) {
    iframe.style.pointerEvents = "auto";
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

if (IS_TOP_FRAME) window.addEventListener("message", (event) => {
  if (event.origin !== "https://loom.dissonance.cloud") return;
  const data = event.data;
  if (!data || data.source !== "loom-clone-bubble") return;

  if (data.type === "drag-start") {
    if (dragState) endDrag(); // cleanup if stale state somehow lingers
    const iframe = document.getElementById(IFRAME_ID);
    if (!iframe) return;
    dragState = {
      offsetX: data.offsetX ?? 0,
      offsetY: data.offsetY ?? 0,
    };
    iframe.style.pointerEvents = "none";
    document.addEventListener("mousemove", onDragMove, true);
    document.addEventListener("mouseup", endDrag, true);
  } else if (data.type === "drag-end-from-iframe") {
    // Race-safety: iframe's own pointerup arrived. Idempotent with the
    // document mouseup listener — whichever fires first wins.
    endDrag();
  }
});
