# Loom Clone — Frameless Bubble (Chrome extension)

Companion extension for Loomola that delivers a true Loom-style frameless circle
camera bubble during recording.

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

No source editing required. Load the extension as-is, then point it at your
instance from the built-in options page.

1. Open `chrome://extensions` in Chrome (or any Chromium browser — Brave,
   Edge, Arc).
2. Toggle **Developer mode** on (top-right).
3. If an older Loom Clone unpacked extension is already loaded, remove it.
4. Click **Load unpacked**.
5. Select the `extension/` directory in this repo.
6. The extension's icon should appear in the toolbar. Click it to see the
   status (idle / recording).

### Pointing the extension at your own Loomola instance

By default the extension talks to `https://loom.dissonance.cloud`. To use your
own self-hosted instance:

1. Right-click the extension icon → **Options** (or click "Change app origin…"
   in the popup).
2. Enter your instance URL, e.g. `https://loomola.example.com`. For local
   development, `http://localhost:3000` is accepted (http is allowed for
   localhost only — all other origins require https).
3. Click **Save**. Reload any already-open Loomola tabs.

**No re-editing of `manifest.json` is needed.** The extension registers the
app bridge (`content-script-app.js`) dynamically for your origin via
`chrome.scripting.registerContentScripts`, which is already authorized by the
manifest's required `<all_urls>` host permission (needed for the bubble
injector). Chrome match patterns ignore port numbers, so the bridge matches
your host on any port — harmless for typical single-port deployments.

When no origin is stored, the default (`loom.dissonance.cloud`) is used
automatically — Ian's install is unchanged.

## Use

1. Start a recording at your Loomola `/record` page.
2. Pick the tab or window you want to record in Chrome's share picker.
3. Switch to that tab — a frameless circle bubble appears in the bottom-right.
4. Drag the bubble anywhere on the page. The composite recording follows.

For Granola-alt, the same extension also watches active Google Meet,
Microsoft Teams web, and Zoom web tabs. It stores and forwards a
`meeting-active` signal so the app can offer a consent-first meeting prompt;
it does not start recording by itself.

To bridge those browser signals into the local desktop app during development,
click `Install Chrome Bridge` in the desktop app after loading the unpacked
extension. The same installer can still be run from the terminal:

```sh
cd /path/to/loomola
desktop/scripts/install-native-messaging-host.sh
```

The extension has a stable unpacked-extension ID, so the script can register
the host even when Chrome's profile metadata has not been flushed to disk. If
manual registration is ever needed, the stable ID is
`fhlommkndlhemikefocglkknpofgkfkj`:

```sh
desktop/scripts/install-native-messaging-host.sh fhlommkndlhemikefocglkknpofgkfkj
```

## Architecture

See [`docs/superpowers/specs/2026-04-26-chrome-extension-design.md`](../docs/superpowers/specs/2026-04-26-chrome-extension-design.md)
for the design rationale and message-flow diagram.

Short version:

- `content-script-app.js` runs on the Loomola app origin. Bridges the
  recording app's `window.postMessage` events to / from the extension's
  background service worker.
- `content-script-page.js` runs on every other URL. Injects an
  extension-origin `bubble.html` iframe when recording is in progress, removes
  it when recording stops. On meeting URLs it also watches
  visible Meet/Teams/Zoom meeting pages and reports a `meeting-active` signal
  to the background worker.
- The iframe (extension origin) handles `getUserMedia` + drag interactions.
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
