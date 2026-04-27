# Stage 1.9 — Chrome extension companion

**Goal:** Loom-parity frameless circle bubble during recording. The browser's `documentPictureInPicture` API will always show a chrome titlebar (security requirement). The only way to deliver a true frameless circle on the web is a Chrome extension that injects the bubble as a content-script DOM element directly into the captured tab — exactly the architecture Loom's web product uses.

**Non-goal:** replacing the recording flow. The extension is opt-in polish that augments the existing recording UX. Users without it still get the docPiP fallback we shipped in Stage 1.8.

---

## Architecture

```
┌─ Captured tab (any origin) ──────────────────┐
│                                              │
│  Page content (whatever's being recorded)    │
│                                              │
│  ┌─ Extension content script ──────────────┐ │
│  │  Injects an <iframe>                    │ │
│  │  src=https://loom.dissonance.cloud/     │ │
│  │       bubble?session=<id>                │ │
│  └─────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
                    ▲
                    │ cross-origin postMessage
                    │ (drag deltas, mount/unmount)
                    ▼
┌─ Extension background service worker ────────┐
│  Routes between content scripts via          │
│  chrome.tabs.sendMessage / chrome.runtime    │
└──────────────────────────────────────────────┘
                    ▲
                    │ chrome.runtime messaging
                    ▼
┌─ loom.dissonance.cloud tab ──────────────────┐
│                                              │
│  Recording app (existing). Receives          │
│  position updates and writes them to the     │
│  existing BubblePositionController. The      │
│  compositor picks them up next frame.        │
│                                              │
│  Sends "recording-started" / "stopped"       │
│  signals so the extension knows when to      │
│  inject / remove the bubble.                 │
└──────────────────────────────────────────────┘
```

**Why an iframe pointing at our own domain?** Because `loom.dissonance.cloud` already has camera permission. Rendering the bubble as an `<iframe src=https://loom.dissonance.cloud/bubble>` inside any captured tab means the iframe has same-origin access to the camera and can show the live feed without re-prompting on every visited page. The extension's role is to inject + position the iframe; the iframe itself handles camera + drag interactions.

---

## Components

### 1. Extension package (`extension/`)
- `manifest.json` (Manifest v3)
- `background.js` — service worker; routes messages between content scripts; tracks "is loom-clone tab recording right now?" state.
- `content-script-app.js` — runs on `loom.dissonance.cloud`. Bridges window-level postMessage from the app ↔ chrome.runtime messages.
- `content-script-page.js` — runs on `<all_urls>`. Injects the bubble iframe into the active captured tab when recording is live; removes when done.
- `popup.html` / `popup.js` — toolbar popup (small status indicator: "Recording in progress" / "Open Loom Clone").
- `icons/` — 16/32/48/128 px PNGs.

### 2. Hosted bubble page (in main app)
- New route `/bubble` rendered in iframe inside captured tabs.
- Reads a session id from query string, opens an `RTCPeerConnection` (or just calls `getUserMedia` directly — both work since the iframe is loom-clone origin).
- Renders a circular `<video>` with the live camera, plus drag handlers.
- On drag, posts `{ type: "loom-clone:bubble:drag", x, y }` to the parent window (the captured tab's window).
- The parent window's extension content script picks up the postMessage and forwards via `chrome.runtime`.

### 3. Main-app changes
- Recording flow emits `window.postMessage({ source: "loom-clone", type: "recording-started", session })` and `..."recording-stopped"`.
- Listens for `window.postMessage({ source: "loom-clone-extension", type: "bubble-position", x, y })` and writes into the existing `BubblePositionController`.
- Existing `BubblePipWindow` (Stage 1.8) is hidden when the extension is detected (so we don't get two bubbles).

---

## MVP scope (this commit)

- Manifest, background, content scripts scaffolded.
- Toolbar popup with status text.
- `/bubble` route added to the main app — renders a live-camera circular video with drag.
- Cross-tab postMessage round-trip working: drag on the bubble in tab A → position updates in the loom-clone tab B → compositor reflects it next frame.
- Extension auto-detects recording start/stop and injects/removes the bubble accordingly.
- README with install steps for unpacked extension.

## Stretch goals (deferred if time runs short)

- Hover-to-resize on the bubble (Loom shows three sizes on hover).
- Hover-to-stop button (small "stop" pill bottom of the bubble like Loom).
- Bubble shape variants (circle / rounded-square / hexagon — already supported by the compositor; bubble iframe just changes border-radius / clip-path).
- Detection of when extension is installed → main app hides the docPiP fallback.
- Multi-monitor screen-coord translation (current MVP assumes single monitor for the position math).

## Out of scope

- Chrome Web Store publishing (manual review, requires user action). MVP loads as unpacked.
- Firefox / Safari support (different extension APIs; this is Chrome only by design — same as the rest of Stage 1).
- Extension-side recording start/stop (recording is still kicked off from the main app's `/record` page).

## Risks

- **Cross-origin postMessage from iframe to top window** is fine for MV3, but the iframe must validate the parent's origin (or accept any, since it doesn't matter for our payload).
- **Service worker idle eviction** — MV3 background scripts get killed after ~30s idle. Needs to be stateless or persisted via `chrome.storage`. State for "is recording" is small enough to live in storage.
- **iframe getUserMedia under content-script injection** — iframes have their own permissions. Since the iframe is loaded from `loom.dissonance.cloud` and that origin already has camera permission, this should work. If it doesn't (browser quirk), fallback to a placeholder circle and document the limitation.
- **Race condition on injection** — extension might inject before the captured tab finishes loading. Handled with a retry / DOMContentLoaded listener.

---

## Done definition

1. Extension loads as unpacked from `chrome://extensions`.
2. Visit any other tab while loom-clone is recording — frameless circle bubble appears, draggable.
3. Position updates flow back to the recording's composite output.
4. Extension popup shows correct status.
5. `extension/README.md` documents install + dev steps.
6. ROADMAP marks Stage 1.9 ✅ shipped.
