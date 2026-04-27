# Claude overnight handoff — 2026-04-26

## What shipped

### Stage 1.9 — Chrome extension companion (`ec3bec7`)

The frameless-circle bubble that delivers true Loom-parity polish. Lives in
`extension/` as a separate package, loads as an unpacked Chrome extension.

**Files:**
- `extension/manifest.json` — Manifest V3, two content scripts, MV3 service worker.
- `extension/background.js` — message router; persists "is recording" in `chrome.storage.session` (survives MV3 idle eviction).
- `extension/content-script-app.js` — runs on `loom.dissonance.cloud`; bridges window-postMessage ↔ chrome.runtime.
- `extension/content-script-page.js` — runs on `<all_urls>` (excluded on loom-clone); injects the bubble iframe, translates iframe drag deltas into fractional-position updates.
- `extension/popup.html` + `popup.js` — toolbar status pill (idle / recording).
- `extension/README.md` — install steps for unpacked mode.
- `src/app/bubble/page.tsx` + `bubble-client.tsx` — the iframe target. Renders a draggable transparent live-camera circle.
- `src/components/record/extension-bridge.tsx` — recording-app side. Posts `recording-started` / `recording-stopped`, listens for `bubble-position`, suppresses the in-app docPiP fallback when the extension is detected.

**Spec:** `docs/superpowers/specs/2026-04-26-chrome-extension-design.md`

### Documentation refresh (`96feaee`)

- `CLAUDE.md` and `AGENTS.md` rewritten end-to-end. The "Future-milestone Services (not yet wired)" block was misleading: R2, Deepgram, Anthropic, and Mailgun (NOT Resend — that was wrong) have all been wired and live in production for weeks.
- `ROADMAP.md` adds Stage 1.7, 1.8, 1.9 plus a new "Open follow-ups" table listing the next candidate milestones with rough effort estimates.

## What you need to do to verify the extension works

(I can't load the unpacked extension into your Chrome from here.)

1. After Coolify redeploys, visit `https://loom.dissonance.cloud/bubble` directly. Should render a small circular live camera — that's the iframe target. If it works in isolation, the iframe-side flow is healthy.
2. Open `chrome://extensions`, toggle Developer mode, click **Load unpacked**, select `extension/`. The extension should appear in the toolbar.
3. (Optional) Add icons to `extension/icons/` per `extension/icons/README.md`. Until then Chrome shows a default puzzle-piece icon — functional, just unbranded.
4. Start a recording at https://loom.dissonance.cloud/record.
5. Pick **Tab** or **Window** in the share picker, choose any other tab.
6. Switch to that tab — the frameless camera circle should appear in the bottom-right.
7. Drag it. The position should update live in the recorded composite.
8. Stop the recording. The bubble disappears.

## Likely issues to debug if it doesn't work first try

1. **Manifest service-worker registration** — service worker has `type: "module"` so it can use ES module imports if needed. If Chrome rejects the manifest, simplify to a regular service worker (drop `type`).
2. **Cross-origin postMessage** — the iframe inside captured tabs uses `window.parent.postMessage(payload, "*")`. The captured tab's content script filters by `event.origin === "https://loom.dissonance.cloud"` for security. If the iframe's origin reports something different (e.g. the static-asset CDN), adjust the filter.
3. **Camera permission in iframe** — works because the iframe is loom-clone origin and that origin already has camera permission from the user's `/record` flow. If a fresh browser profile, the iframe will prompt for camera; that's expected first-time behavior.
4. **Position math** — extension reads the iframe's `getBoundingClientRect()` to compute fractional position relative to the captured tab's viewport (not the full screen). This matches what the user "expects to see" in the recording. If it feels off after testing, easiest fix is in `extension/content-script-page.js`'s drag handler.
5. **Race between `recording-started` post and the bubble appearing** — the extension polls all open tabs on `recording-started` and tries to inject. If a tab refreshed mid-recording, the new content-script asks the background for state on load and re-injects. If you see the bubble disappear after a navigation, that's the path the recovery runs through.

## Falls back gracefully

If the extension is **not** installed, the recording flow continues to use the docPiP bubble fallback shipped in Stage 1.8 — exactly the same behavior as before this commit. No regression for users who don't install the extension.

## What to do next

1. Manually verify the extension. Paste back any errors from the browser console for fast iteration.
2. Add proper icons to `extension/icons/`.
3. When happy, decide whether to publish to Chrome Web Store (manual review process; requires user action).
4. Codex shipped a macOS desktop app spec at `70da3f0`. Review that next; their handoff will be at `docs/superpowers/handoffs/`.
