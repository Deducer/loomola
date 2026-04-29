/**
 * Bubble iframe loaded via chrome-extension://<id>/bubble.html so that
 * camera permission grants persist across every captured page (one
 * prompt at first use for the extension's origin, then never again).
 *
 * Vanilla JS port of src/app/bubble/bubble-client.tsx, with an added
 * Loom-style size picker (three dots) revealed on hover.
 *
 * Communicates with the parent's content-script-page.js via postMessage:
 *   - "drag-start" / "drag-end-from-iframe" — drag handoff (parent owns
 *     mousemove/mouseup so the cursor doesn't get stuck on the iframe).
 *   - "size-change" — user clicked a size dot; parent resizes the iframe
 *     element and persists the new size via chrome.runtime.
 */

const params = new URLSearchParams(location.search);
const shape = params.get("shape") || "circle";
let currentSize = params.get("size") || "medium";

const video = document.getElementById("cam");
const bubble = document.getElementById("bubble");
const toolbar = document.getElementById("toolbar");

// ----- shape -----

function applyShape(shape) {
  switch (shape) {
    case "hexagon":
      video.style.clipPath =
        "polygon(25% 6.7%, 75% 6.7%, 100% 50%, 75% 93.3%, 25% 93.3%, 0% 50%)";
      video.style.borderRadius = "0";
      break;
    case "rounded-square":
      video.style.clipPath = "none";
      video.style.borderRadius = "18%";
      break;
    case "rectangle":
      video.style.clipPath = "none";
      video.style.borderRadius = "8%";
      break;
    case "circle":
    default:
      video.style.clipPath = "none";
      video.style.borderRadius = "50%";
      break;
  }
}
applyShape(shape);

// ----- size picker -----

function setActiveSize(size) {
  currentSize = size;
  for (const btn of toolbar.querySelectorAll(".toolbar-btn")) {
    btn.classList.toggle("active", btn.dataset.size === size);
  }
}
setActiveSize(currentSize);

toolbar.addEventListener("click", (e) => {
  const btn = e.target.closest(".toolbar-btn");
  if (!btn) return;
  e.stopPropagation();
  const next = btn.dataset.size;
  if (!next || next === currentSize) return;
  setActiveSize(next);
  // Tell the parent content script to resize the iframe element + persist.
  window.parent.postMessage(
    { source: "loom-clone-bubble", type: "size-change", size: next },
    "*"
  );
});

// ----- camera -----

(async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });
    video.srcObject = stream;
  } catch (err) {
    bubble.innerHTML = '<div class="err">camera unavailable</div>';
    console.warn("[loom-clone-ext bubble] getUserMedia failed:", err);
  }
})();

// ----- drag handoff to parent -----

let dragStarted = false;

function isFromToolbar(e) {
  return !!(e.target && e.target.closest && e.target.closest("#toolbar"));
}

window.addEventListener("pointerdown", (e) => {
  if (isFromToolbar(e)) return;
  if (e.button !== 0) return;
  e.preventDefault();
  dragStarted = true;
  // offsetX/Y is the click's iframe-local position; the parent uses it
  // to pin the click point to the cursor for the whole drag.
  window.parent.postMessage(
    {
      source: "loom-clone-bubble",
      type: "drag-start",
      offsetX: e.clientX,
      offsetY: e.clientY,
    },
    "*"
  );
});

function endDrag() {
  if (!dragStarted) return;
  dragStarted = false;
  window.parent.postMessage(
    { source: "loom-clone-bubble", type: "drag-end-from-iframe" },
    "*"
  );
}
window.addEventListener("pointerup", endDrag);
window.addEventListener("pointercancel", endDrag);

// Parent can push the active size back to us (e.g. when state was set
// somewhere else and a fresh iframe needs to reflect it).
window.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.source !== "loom-clone-parent") return;
  if (data.type === "set-size" && typeof data.size === "string") {
    setActiveSize(data.size);
  }
});
