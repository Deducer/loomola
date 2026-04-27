# Codex handoff — 2026-04-27

## What shipped

- Added the macOS desktop companion design spec:
  - `docs/superpowers/specs/2026-04-27-macos-desktop-app-design.md`
- Added the implementation plan:
  - `docs/superpowers/plans/2026-04-27-macos-desktop-app.md`
- Added / confirmed the Swift desktop scaffold under:
  - `desktop/`
- Updated `ROADMAP.md`, `AGENTS.md`, and `CLAUDE.md` so future agents know the macOS app is spec'd and ready to build.

## Decisions to review

- **Native Swift + SwiftUI + AppKit + ScreenCaptureKit** is the chosen stack. The reason is the Loom-style transparent, frameless, draggable camera bubble. Native macOS APIs give us that directly; Electron/Tauri would still need native capture/window work and add weight.
- **Desktop remains record/upload only.** The web app remains the source of truth for recordings, brand profiles, comments, analytics, AI outputs, and editing.
- **MP4/AAC for native v1.** AVFoundation's stable path is H.264/AAC MP4/M4A. The plan calls for a tiny backend compatibility patch so `/api/recordings/start` can choose `.mp4` / `.m4a` keys when the desktop app sends MP4 MIME types while preserving the current web `.webm` flow.
- **Bearer-token auth for desktop API calls.** The browser uses Supabase cookies; the desktop app should send `Authorization: Bearer <supabase access token>`. The first backend task is to ensure `requireAuth` accepts that path for `/api/recordings/*`.
- **DMG distribution over Mac App Store.** Requires Apple Developer Program membership for signing/notarization, but avoids App Store review delays and sandbox friction.

## Validation

- `swift package dump-package` passed from `desktop/` after allowing Swift Package Manager to use its normal cache directories.
- I did not run `swift build` because resolving `supabase-swift` may need network access and this scaffold is not intended to be a finished app yet.
- I did not run the web unit suite because the known pre-existing `tests/unit/ai-schemas.test.ts > rejects negative timestamps` failure is unrelated and was explicitly out of scope.

## Next agent should do first

1. Implement bearer-token auth support in the existing Next.js API auth helper.
2. Update `/api/recordings/start` key generation so MP4/M4A MIME types get matching object extensions.
3. Add API tests for a desktop-shaped recording start/part-url/complete flow.
4. Open `desktop/` in Xcode and create a real macOS App target from the SwiftPM scaffold so permissions, signing, and entitlements behave like a bundled app.

After that, proceed through the plan in `docs/superpowers/plans/2026-04-27-macos-desktop-app.md`.
