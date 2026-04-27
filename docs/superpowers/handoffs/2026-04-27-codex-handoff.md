# Codex handoff — 2026-04-27

## What shipped

- Added the macOS desktop companion design spec:
  - `docs/superpowers/specs/2026-04-27-macos-desktop-app-design.md`
- Added the implementation plan:
  - `docs/superpowers/plans/2026-04-27-macos-desktop-app.md`
- Added / confirmed the Swift desktop scaffold under:
  - `desktop/`
- Updated `ROADMAP.md`, `AGENTS.md`, and `CLAUDE.md` so future agents know the macOS app is spec'd and ready to build.
- Implemented the first desktop compatibility slice in the web backend:
  - bearer-token auth support for native clients in `src/lib/require-auth.ts`
  - middleware pass-through for bearer-authenticated `/api/recordings/*` calls
  - MP4/M4A key generation for desktop MIME types while preserving WebM for the browser recorder
  - focused unit tests in `tests/unit/desktop-api-compat.test.ts`
- Advanced `desktop/` from scaffold to early test app:
  - Supabase email/password sign-in shell
  - Keychain-backed token storage
  - backend start/abort handshake button
  - capture source listing for displays/windows/cameras/mics
  - ScreenCaptureKit first-display MP4 recording path on macOS 15+
  - upload of that MP4 as the existing backend's `composite` track
  - draggable circular camera bubble panel with live camera preview
  - `desktop/scripts/run-dev.sh` and `desktop/.env.example`

## Decisions to review

- **Native Swift + SwiftUI + AppKit + ScreenCaptureKit** is the chosen stack. The reason is the Loom-style transparent, frameless, draggable camera bubble. Native macOS APIs give us that directly; Electron/Tauri would still need native capture/window work and add weight.
- **Desktop remains record/upload only.** The web app remains the source of truth for recordings, brand profiles, comments, analytics, AI outputs, and editing.
- **MP4/AAC for native v1.** AVFoundation's stable path is H.264/AAC MP4/M4A. The plan calls for a tiny backend compatibility patch so `/api/recordings/start` can choose `.mp4` / `.m4a` keys when the desktop app sends MP4 MIME types while preserving the current web `.webm` flow.
- **Bearer-token auth for desktop API calls.** Implemented for `/api/recordings/*`. The browser still uses Supabase cookies.
- **DMG distribution over Mac App Store.** Requires Apple Developer Program membership for signing/notarization, but avoids App Store review delays and sandbox friction.
- **Current desktop recording path is screen-only composite.** It records the first display to MP4 and uploads it as `composite`. The camera bubble is visible locally but is not yet composited into the exported video.

## Validation

- `npm run typecheck` passed.
- `npx vitest run tests/unit/desktop-api-compat.test.ts` passed.
- `swift test` passed from `desktop/` after resolving `supabase-swift`.
- I did not run the full web unit suite because the known pre-existing `tests/unit/ai-schemas.test.ts > rejects negative timestamps` failure is unrelated and was explicitly out of scope.

## How to try it

From `desktop/`:

```bash
./scripts/run-dev.sh
```

The script can reuse the repo-root `.env.local` web-app variables (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_APP_URL`) or a desktop-local `.env.local` copied from `desktop/.env.example`.

What should be testable:

- Sign in with the creator email/password.
- `Test Backend` creates a desktop-shaped recording row and aborts it.
- `Refresh Sources` lists displays/windows/cameras/mics.
- Menu bar `Show Bubble Overlay` opens a draggable circular live-camera bubble.
- `Start Recording` starts first-display MP4 recording on macOS 15+.
- `Stop` finalizes and uploads that MP4 as the composite track; it should appear in the web dashboard and flow through the existing backend pipeline.

Likely caveats:

- SwiftPM runs a raw executable, not a polished signed `.app` bundle. macOS privacy prompts are more reliable after creating a real Xcode app target.
- The current recording does not include the camera bubble in the exported video.
- The current recording uploads only `composite`, not raw screen/camera/mic/system-audio tracks.

## Next agent should do first

1. Run `desktop/scripts/run-dev.sh` on Ian's Mac and manually test sign-in, source refresh, live bubble, backend handshake, and first-display upload.
2. Open `desktop/` in Xcode and create a real macOS App target from the SwiftPM scaffold so permissions, signing, and entitlements behave like a bundled app.
3. Replace the ScreenCaptureKit `SCRecordingOutput` shortcut with an `AVAssetWriter` compositor so screen + live camera bubble are rendered into the exported composite.
4. Add raw track writers for screen/camera/mic/system-audio and upload all expected track kinds.
5. Add progress reporting and local-file retry/recovery for failed uploads.

After that, proceed through the plan in `docs/superpowers/plans/2026-04-27-macos-desktop-app.md`.
