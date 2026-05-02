/**
 * Content script that runs on every URL.
 *
 * Receives "show-bubble" / "hide-bubble" messages from the background
 * service worker and injects an iframe pointing at the extension's
 * own bubble.html (chrome-extension://<id>/bubble.html). Loading the
 * bubble from the extension origin (rather than loom.dissonance.cloud)
 * means camera permission is granted ONCE for the extension and
 * persists across every captured page — Loom-style, no per-tab
 * "Allow camera?" prompt.
 *
 * Drag events bubble up from the iframe via postMessage and we forward
 * them to the background so they reach the recording app's tab. The
 * iframe also posts "size-change" when the user clicks one of the
 * built-in size dots; we resize the iframe element + persist the new
 * size in chrome.storage.session via the background.
 */

const IFRAME_ID = "__loom_clone_bubble_iframe__";
const IFRAME_SIZE_PX = {
  small: 160,
  medium: 220,
  large: 280,
};

// chrome.runtime.getURL("") returns "chrome-extension://<id>/" on most
// platforms; the bubble's postMessages will arrive with this as the
// `event.origin`.
const BUBBLE_ORIGIN = (() => {
  try {
    return new URL(chrome.runtime.getURL("")).origin;
  } catch {
    return null;
  }
})();

function ensureIframe(state) {
  let iframe = document.getElementById(IFRAME_ID);
  if (iframe) return iframe;

  iframe = document.createElement("iframe");
  iframe.id = IFRAME_ID;
  const params = new URLSearchParams({
    shape: state.bubbleShape ?? "circle",
    size: state.bubbleSize ?? "medium",
  });
  iframe.src = chrome.runtime.getURL("bubble.html") + "?" + params.toString();
  iframe.allow = "camera; microphone";

  const sizePx = IFRAME_SIZE_PX[state.bubbleSize ?? "medium"];
  Object.assign(iframe.style, {
    position: "fixed",
    width: `${sizePx}px`,
    height: `${sizePx}px`,
    pointerEvents: "auto",
  });
  // Use setProperty with !important for the visual properties that
  // host pages sometimes override via global iframe styling
  // (Coolify's dashboard had `iframe { background: ... }` that beat
  // our inline-style background, leaving a visible square around the
  // circle). Inline styles without !important lose to !important
  // declarations in stylesheets, so we explicitly assert priority
  // for anything that affects whether the iframe reads as transparent.
  iframe.style.setProperty("background", "transparent", "important");
  iframe.style.setProperty("background-color", "rgba(0,0,0,0)", "important");
  iframe.style.setProperty("border", "none", "important");
  iframe.style.setProperty("color-scheme", "normal", "important");
  iframe.style.setProperty("z-index", "2147483647", "important");

  // If background gave us a remembered fractional position (set on the
  // previous drag-end, persisted in chrome.storage.session), spawn the
  // iframe with its center at that position so it stays put when the
  // user switches tabs. Otherwise fall back to bottom-right anchor.
  const pos = state.position;
  if (
    pos &&
    typeof pos.x === "number" &&
    typeof pos.y === "number"
  ) {
    const w = window.innerWidth || 1920;
    const h = window.innerHeight || 1080;
    const cx = pos.x * w;
    const cy = pos.y * h;
    iframe.style.left = `${Math.max(8, Math.min(w - sizePx - 8, cx - sizePx / 2))}px`;
    iframe.style.top = `${Math.max(8, Math.min(h - sizePx - 8, cy - sizePx / 2))}px`;
  } else {
    iframe.style.bottom = "32px";
    iframe.style.right = "32px";
  }

  iframe.setAttribute("aria-label", "Loom Clone camera bubble");
  document.documentElement.appendChild(iframe);
  console.log(
    "[loom-clone-ext] iframe injected on",
    location.href,
    "size",
    sizePx,
    "pos",
    pos ?? "default-bottom-right"
  );
  return iframe;
}

function removeIframe() {
  const iframe = document.getElementById(IFRAME_ID);
  if (iframe) iframe.remove();
}

console.log(
  "[loom-clone-ext v0.7.0] content-script-page loaded on",
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

const MEETING_DETECTORS = [
  {
    source: "meet",
    label: "Google Meet",
    hostMatches: () => location.hostname === "meet.google.com",
    matches: () => location.hostname === "meet.google.com",
    activeLabels: ["leave call", "leave meeting"],
  },
  {
    source: "teams",
    label: "Microsoft Teams",
    hostMatches: () => location.hostname === "teams.microsoft.com",
    matches: () =>
      location.hostname === "teams.microsoft.com" &&
      location.pathname.startsWith("/v2/"),
    activeLabels: ["leave"],
  },
  {
    source: "zoom",
    label: "Zoom",
    hostMatches: () =>
      location.hostname === "zoom.us" || location.hostname.endsWith(".zoom.us"),
    matches: () =>
      (location.hostname === "zoom.us" ||
        location.hostname.endsWith(".zoom.us")) &&
      location.pathname.startsWith("/wc/"),
    activeLabels: ["leave"],
  },
];

function currentMeetingDetector() {
  return MEETING_DETECTORS.find((detector) => detector.matches()) ?? null;
}

function isPotentialMeetingHost() {
  return MEETING_DETECTORS.some((detector) => detector.hostMatches());
}

function hasActiveCallDom(detector) {
  if (document.querySelector('[data-call-state="active"]')) return true;
  const elements = document.querySelectorAll(
    'button,[role="button"],a,[aria-label],[title]'
  );
  for (const el of elements) {
    const label = [
      el.getAttribute("aria-label"),
      el.getAttribute("title"),
      el.textContent,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (detector.activeLabels.some((needle) => label.includes(needle))) {
      return true;
    }
  }
  return false;
}

async function hasGrantedMicPermission() {
  try {
    if (!navigator.permissions?.query) return false;
    const status = await navigator.permissions.query({ name: "microphone" });
    return status.state === "granted";
  } catch {
    return false;
  }
}

function normalizeMeetingTitle(detector) {
  const title = document.title?.trim();
  if (!title) return detector.label;
  return title;
}

function startMeetingWatcher() {
  let lastSignal = null;

  async function checkMeeting() {
    const detector = currentMeetingDetector();
    if (!detector || document.visibilityState !== "visible") return;

    const activeByDom = hasActiveCallDom(detector);
    const activeByMic = activeByDom ? false : await hasGrantedMicPermission();
    if (!activeByDom && !activeByMic) return;

    const now = Date.now();
    const title = normalizeMeetingTitle(detector);
    const key = `${detector.source}:${location.href}:${title}`;
    if (lastSignal?.key === key && now - lastSignal.ts < 60_000) return;
    lastSignal = { key, ts: now };

    void safeSendMessage({
      type: "loom-clone:meeting-active",
      meeting: {
        event: "meeting-active",
        source: detector.source,
        title,
        tabUrl: location.href,
        ts: now,
      },
    });
  }

  window.setTimeout(checkMeeting, 1_000);
  window.setInterval(checkMeeting, 5_000);
  document.addEventListener("visibilitychange", checkMeeting);
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

  if (isPotentialMeetingHost()) {
    startMeetingWatcher();
  }
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

function applyBubbleSize(iframe, size) {
  const sizePx = IFRAME_SIZE_PX[size];
  if (!sizePx) return;
  // Anchor the resize at the iframe's center so the bubble grows /
  // shrinks symmetrically rather than from its top-left corner.
  const rect = iframe.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  iframe.style.width = `${sizePx}px`;
  iframe.style.height = `${sizePx}px`;
  iframe.style.left = `${Math.round(cx - sizePx / 2)}px`;
  iframe.style.top = `${Math.round(cy - sizePx / 2)}px`;
  iframe.style.right = "auto";
  iframe.style.bottom = "auto";
}

if (IS_TOP_FRAME) window.addEventListener("message", (event) => {
  if (BUBBLE_ORIGIN && event.origin !== BUBBLE_ORIGIN) return;
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
  } else if (data.type === "size-change" && typeof data.size === "string") {
    const iframe = document.getElementById(IFRAME_ID);
    if (iframe) applyBubbleSize(iframe, data.size);
    // Persist so tab switches and re-injects in other tabs use the
    // newly-picked size.
    void safeSendMessage({
      type: "loom-clone:bubble-size",
      size: data.size,
    });
  }
});
