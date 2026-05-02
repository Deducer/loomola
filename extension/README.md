# Loom Clone — Frameless Bubble (Chrome extension)

Companion extension for [loom.dissonance.cloud](https://loom.dissonance.cloud)
that delivers a true Loom-style frameless circle camera bubble during recording.

## Why this exists

The browser's `documentPictureInPicture` API will always show a small
chrome titlebar on the floating window — that's a security requirement, not a
missing CSS feature. The only way to get a true frameless circle bubble in the
captured tab is to inject it as a content-script DOM element. That's what
Loom's own web product does, and that's what this extension does.

When the extension is **not** installed, the main app falls back to its
docPiP bubble (functional, but with a titlebar). When the extension **is**
installed, you get the polished frameless experience.

## Install (developer mode)

1. Open `chrome://extensions` in Chrome (or any Chromium browser — Brave,
   Edge, Arc).
2. Toggle **Developer mode** on (top-right).
3. Click **Load unpacked**.
4. Select the `extension/` directory in this repo.
5. The extension's icon should appear in the toolbar. Click it to see the
   status (idle / recording).

## Use

1. Start a recording at https://loom.dissonance.cloud/record.
2. Pick the tab or window you want to record in Chrome's share picker.
3. Switch to that tab — a frameless circle bubble appears in the bottom-right.
4. Drag the bubble anywhere on the page. The composite recording follows.

For Granola-alt, the same extension also watches active Google Meet,
Microsoft Teams web, and Zoom web tabs. It stores and forwards a
`meeting-active` signal so the app can offer a consent-first meeting prompt;
it does not start recording by itself.

To bridge those browser signals into the local desktop app during development,
install the Chrome native messaging host once:

```sh
cd /Users/iancross/Development/03Utilities/Loom_Clone
desktop/scripts/install-native-messaging-host.sh <chrome-extension-id>
```

Find the extension ID on `chrome://extensions` after loading `extension/`.

## Architecture

See [`docs/superpowers/specs/2026-04-26-chrome-extension-design.md`](../docs/superpowers/specs/2026-04-26-chrome-extension-design.md)
for the design rationale and message-flow diagram.

Short version:

- `content-script-app.js` runs on `loom.dissonance.cloud`. Bridges the
  recording app's `window.postMessage` events to / from the extension's
  background service worker.
- `content-script-page.js` runs on every other URL. Injects an
  `<iframe src="https://loom.dissonance.cloud/bubble">` when recording is in
  progress, removes it when recording stops. On meeting URLs it also watches
  for active-call DOM markers or granted microphone permission and reports a
  `meeting-active` signal to the background worker.
- The iframe (loom-clone origin) handles `getUserMedia` + drag interactions.
  Drag events bubble up via cross-origin `postMessage`.
- `background.js` is a Manifest V3 service worker that routes messages
  between content scripts. State (is-recording) is persisted in
  `chrome.storage.session` since service workers get killed after ~30s idle.
  The latest meeting signal is stored there too, so the popup can show it.
- `LoomDesktopNativeHost` is a tiny Swift executable launched by Chrome native
  messaging. It writes the latest meeting signal to Application Support, where
  the desktop app's existing meeting watcher can read it.

## Build / no-build

There's no build step. Plain ES modules in the service worker; everything
else is regular `<script>`. Edit any file and reload the extension at
`chrome://extensions`.

After pulling extension changes, click **Reload** on the unpacked extension in
`chrome://extensions`; Chrome does not automatically reload unpacked
extensions from disk.

## Icons

Drop 16/32/48/128 px PNGs into `extension/icons/` named `icon-16.png` etc.
See `icons/README.md` for a quick `sips` recipe to generate them from a
single source PNG.

## Limits

- Chrome / Chromium only.
- Bubble lives in the captured tab — if the user records the **entire
  screen**, the bubble appears as part of the page being recorded
  (bottom-right of the captured tab, not on the desktop). That's a
  consequence of being a web extension; only a native desktop app can put a
  true system-level overlay on the desktop.
- Manifest V3 service worker idle eviction is well-handled, but if state
  gets out of sync after a long pause, reload the page being recorded.
