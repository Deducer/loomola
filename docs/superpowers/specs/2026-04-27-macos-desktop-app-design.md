# Loom Clone macOS Desktop App — Design Spec

**Author:** Codex  
**Date:** 2026-04-27  
**Status:** Spec'd, ready to build  
**Related plan:** [`docs/superpowers/plans/2026-04-27-macos-desktop-app.md`](../plans/2026-04-27-macos-desktop-app.md)

---

## Overview

Build a native macOS companion app for Loom Clone. The desktop app is a record-and-upload client only: it captures screen, camera, microphone, and system audio locally, uploads media through the existing Next.js multipart endpoints, and lets the already-shipped web app own metadata, processing, viewing, comments, branding, analytics, and editing.

The app exists because the browser cannot fully match Loom's native macOS experience. The killer feature is a transparent, frameless, system-level draggable camera bubble that can float above other apps while the recorder composites that same bubble into the exported video. A native Swift app can do this with `NSPanel` / `NSWindow`; Electron and Tauri make it heavier and more fragile.

The user's reference machine is an M4 Pro Mac, so v1 can assume modern Apple Silicon performance and current macOS APIs.

## Goals

- Native macOS menu bar recorder that feels like Loom's desktop app, not a wrapped web page.
- Single-screen recording MVP using ScreenCaptureKit.
- Camera bubble appears as a frameless, transparent, draggable floating panel.
- Composite recording includes screen + camera bubble + mixed audio.
- Raw track uploads preserve the existing web app's editing/export story.
- Existing dashboard at `https://loom.dissonance.cloud` shows desktop-created recordings with no separate backend.
- Reuse existing auth, R2 bucket, `media_objects` table, `/api/recordings/*` endpoints, and Deepgram/AI/Mailgun pipeline.
- Prepare for signed DMG distribution and Sparkle auto-updates.

## Non-goals for v1

- In-app editing. Trim/editing remains in the web app.
- AI features in the desktop app. Transcription, title, summary, chapters, action items, thumbnails, and preview sprites remain backend jobs.
- Multi-monitor capture. v1 records one selected display or one selected window.
- Team/workspace features.
- Custom domains, brand management, comments, analytics, or share-page editing in the desktop app.
- Mac App Store distribution.
- A separate desktop backend, queue, object store, or database.

---

## Tech Stack Decision

### Chosen stack: Swift + SwiftUI + AppKit + ScreenCaptureKit

Use a native Swift app with:

- **SwiftUI** for the main settings/status window.
- **AppKit** for menu bar integration, global windows, `NSPanel`, and transparent overlay behavior.
- **ScreenCaptureKit** for screen/window/system-audio capture.
- **AVFoundation** for camera, microphone, encoding, and `AVAssetWriter` outputs.
- **supabase-swift** for Supabase authentication.
- **macOS Keychain** via the Security framework for token/session persistence.
- **URLSession** for existing API calls and presigned R2 `PUT` uploads.
- **Sparkle** for auto-updates after the signed DMG distribution path is ready.

Native Swift is the right choice because the differentiator is OS-level capture and overlay polish. The browser implementation already proves the backend and web viewer; the desktop app should focus on the platform primitives the browser cannot provide.

### Alternatives considered

#### Electron

Pros:

- Web technology familiarity.
- Faster initial UI iteration.
- Existing JavaScript upload code could be ported more directly.

Cons:

- Heavy app footprint for a recorder.
- Native screen/audio capture still requires native modules.
- Transparent always-on-top camera bubble is possible but more brittle.
- Code signing/notarization becomes more finicky with bundled Chromium and native helpers.
- Less confidence around excluding/controling windows during capture.

Verdict: not worth the runtime weight or native boundary complexity.

#### Tauri

Pros:

- Smaller than Electron.
- Swift/Rust native hooks are possible.
- Good distribution story for many desktop CRUD apps.

Cons:

- The core work is still macOS-native capture, encoding, overlay windows, permissions, and audio handling.
- Rust bridge adds a second systems language without giving meaningful leverage for ScreenCaptureKit.
- Transparent camera bubble still lands in AppKit/Cocoa territory.

Verdict: good for lightweight desktop shells; not the cleanest fit for a native recorder.

---

## MVP Feature Set

v1 ships exactly this:

1. **Authentication**
   - Sign in using the existing Supabase project.
   - Support email/password first.
   - Support magic link if Supabase redirect/deep-link setup is added.
   - Store Supabase session/token material in macOS Keychain.
   - Never store service-role keys, R2 keys, Deepgram keys, Anthropic keys, or Mailgun keys on the Mac.

2. **Menu bar app**
   - Menu bar item with signed-in state.
   - Main popover/window for recording setup.
   - Quick actions: start recording, stop, pause/resume, open dashboard, sign out.

3. **Capture**
   - Single display or single window capture using ScreenCaptureKit.
   - Camera capture via AVFoundation.
   - Microphone capture via AVFoundation.
   - System audio capture through ScreenCaptureKit where macOS permits it.
   - v1 defaults: 30fps composite, H.264 video, AAC audio.

4. **Loom-style camera bubble**
   - Transparent, frameless, always-on-top `NSPanel`.
   - Draggable anywhere on screen.
   - Rounded/circular mask in the live overlay.
   - Bubble position is fed into the compositor so the exported video contains the bubble in the same place.
   - Overlay controls stay hidden unless hovered.

5. **Recording controls**
   - Start.
   - Pause/resume.
   - Stop.
   - Elapsed time.
   - Recording status and upload progress.

6. **Upload**
   - Use the same `/api/recordings/start`, `/api/recordings/:id/part-url`, `/api/recordings/:id/complete`, and `/api/recordings/:id/abort` endpoints as the web recorder.
   - Upload media parts directly to R2 using presigned URLs from the backend.
   - Desktop app sends the same logical track kinds: `composite`, `screen`, `camera`, `mic`, and `system-audio`.
   - After `complete`, the existing backend queues transcription, thumbnails, AI outputs, comments support, and share-page readiness.

7. **Dashboard visibility**
   - Desktop-created recordings appear in the existing dashboard.
   - Open Recording action launches `https://loom.dissonance.cloud/recordings/:id/edit` or `/v/:slug` after upload completes.

---

## Existing Backend Integration

The desktop app must reuse the web app's backend. No separate backend is designed.

### API calls

Base URL:

```text
https://loom.dissonance.cloud
```

Auth:

- Use Supabase user session from `supabase-swift`.
- Send the user's access token to Next.js API calls in an `Authorization: Bearer <token>` header.
- The web app currently relies primarily on Supabase SSR cookies for browser requests. Desktop implementation should first try bearer tokens against `requireAuth`; if that helper does not accept bearer auth yet, add a small backend compatibility patch to accept Supabase JWTs for `/api/recordings/*` without changing the storage/database design.

Recording start:

```http
POST /api/recordings/start
Authorization: Bearer <supabase-access-token>
Content-Type: application/json

{
  "tracks": [
    { "kind": "composite", "mimeType": "video/mp4" },
    { "kind": "screen", "mimeType": "video/mp4" },
    { "kind": "camera", "mimeType": "video/mp4" },
    { "kind": "mic", "mimeType": "audio/mp4" },
    { "kind": "system-audio", "mimeType": "audio/mp4" }
  ],
  "resolution": "screen-native",
  "brandProfileId": null,
  "client": "macos"
}
```

The current endpoint already accepts track MIME types and stores R2 object content types. It currently uses `.webm` keys because the browser emits WebM. Native macOS does not have first-class WebM encoding. The first implementation task should update key generation to choose the object extension from `mimeType` while keeping the route and database columns unchanged:

- `video/webm` -> `.webm`
- `audio/webm` -> `.webm`
- `video/mp4` -> `.mp4`
- `audio/mp4` -> `.m4a`

This is a compatibility extension to the existing endpoint, not a new backend.

Part URL:

```http
POST /api/recordings/:id/part-url
Authorization: Bearer <supabase-access-token>
Content-Type: application/json

{
  "track": "composite",
  "partNumber": 1
}
```

Upload part:

```http
PUT <presigned R2 URL>
Content-Type: video/mp4

<bytes>
```

Complete:

```http
POST /api/recordings/:id/complete
Authorization: Bearer <supabase-access-token>
Content-Type: application/json

{
  "tracks": {
    "composite": [{ "PartNumber": 1, "ETag": "\"...\"" }],
    "screen": [{ "PartNumber": 1, "ETag": "\"...\"" }]
  },
  "durationSeconds": 123.4
}
```

Abort:

```http
POST /api/recordings/:id/abort
Authorization: Bearer <supabase-access-token>
```

### Database ownership

The desktop app never writes Postgres directly. The existing API creates the `media_objects` row with the signed-in user's `owner_id`. Processing remains identical after upload completion.

### Media format

Native v1 should encode MP4/AAC, not WebM. Reasons:

- AVFoundation's stable native path is `AVAssetWriter` -> H.264/AAC MP4 or M4A.
- Deepgram accepts media URLs and is not tied to WebM.
- ffmpeg thumbnail/sprite jobs can read MP4.
- Browser `<video>` playback supports MP4.
- R2 stores by content type; the database stores opaque keys.

Backend compatibility work is limited to extension/content-type handling and, if needed, share/download filenames.

---

## Architecture

```text
LoomDesktopApp
├── Auth
│   ├── SupabaseAuthClient
│   └── KeychainSessionStore
├── UI
│   ├── MenuBarController
│   ├── MainRecorderWindow
│   └── BubbleOverlayWindowController
├── Capture
│   ├── ScreenCaptureCoordinator
│   ├── CameraCaptureCoordinator
│   ├── AudioCaptureCoordinator
│   └── CompositeRecorder
├── Upload
│   ├── BackendClient
│   └── MultipartUploadCoordinator
└── Models
    ├── TrackKind
    ├── RecordingSettings
    └── RecordingSession
```

### Capture pipeline

1. User chooses display/window, camera, mic, and system-audio setting.
2. `ScreenCaptureCoordinator` requests Screen Recording permission and starts ScreenCaptureKit.
3. `CameraCaptureCoordinator` starts camera frames.
4. `AudioCaptureCoordinator` captures microphone and system audio.
5. `BubbleOverlayWindowController` shows a transparent draggable live camera bubble.
6. `CompositeRecorder` renders screen frames + camera bubble into a composite video while separate raw writers save screen, camera, mic, and system audio tracks.
7. `MultipartUploadCoordinator` uploads output files in 8MB parts through the existing backend part-url flow.

### Bubble overlay

Use an `NSPanel` with:

- `isOpaque = false`
- `backgroundColor = .clear`
- `level = .floating` or `.screenSaver` only if floating is insufficient
- `collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]`
- borderless style mask
- custom draggable content view
- camera preview layer masked to circle/rounded rectangle

The overlay's window frame is the source of truth for bubble position. The compositor maps that frame into captured-screen coordinates.

The visible overlay and the exported bubble should be driven from the same `BubblePlacement` model. Do not rely on the OS capturing the overlay window. That is fragile and can create recursion or titlebar artifacts. The recorder should composite camera frames into the output intentionally.

### Recording state machine

```text
signedOut
  -> signedInIdle
  -> preparingPermissions
  -> readyToRecord
  -> recording
  -> paused
  -> finalizing
  -> uploading
  -> complete
  -> signedInIdle
```

Error states:

- permissionDenied
- captureFailed
- uploadFailed
- backendRejected

Each error state should show a recovery action. For upload failures, keep the local files until the user discards them.

---

## Authentication

Use `supabase-swift` with the existing Supabase project:

- `NEXT_PUBLIC_SUPABASE_URL` equivalent becomes `LOOM_SUPABASE_URL` in the desktop app build configuration.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` equivalent becomes `LOOM_SUPABASE_ANON_KEY`.

Token storage:

- Store access token, refresh token, and expiry in macOS Keychain.
- Keychain service name: `cloud.dissonance.loom.desktop`.
- On app launch, load the saved session and refresh if needed.
- On sign out, delete Keychain entries and reset UI state.

Magic link:

- Preferred user-facing flow eventually.
- Requires a custom URL scheme such as `loomclone://auth/callback` or associated domain setup.
- v1 can ship email/password first if deep-link callback setup slows the build.

Backend compatibility:

- The web app's browser auth uses cookies.
- The desktop app should use bearer JWTs.
- If `requireAuth` only reads cookies, add support for `Authorization: Bearer` to server-side auth helpers.

---

## Code Signing, Notarization, and Distribution

### Code signing

Distribution outside the Mac App Store requires:

- Apple Developer Program membership, currently about `$99/year`.
- Developer ID Application certificate.
- Developer ID Installer certificate if shipping a `.pkg`; DMG-only distribution can sign the app bundle and notarize the DMG.
- Hardened Runtime enabled.
- Entitlements for camera, microphone, and networking.

### Notarization

Release process:

1. Archive app in Xcode.
2. Sign with Developer ID Application.
3. Create DMG.
4. Sign DMG.
5. Submit with `xcrun notarytool`.
6. Staple notarization ticket with `xcrun stapler`.
7. Upload DMG and Sparkle appcast assets to `loom.dissonance.cloud`.

### Distribution choice

Prefer direct DMG download from `loom.dissonance.cloud`, not the Mac App Store.

Reasons:

- Avoid weeks of App Store review.
- Avoid sandbox restrictions that can complicate capture workflows.
- Faster iteration for a solo/private tool.
- Easier to support pre-release builds.

### Auto-updates

Use Sparkle 2 for auto-updates:

- EdDSA key pair stored outside the repo.
- Appcast XML hosted at `https://loom.dissonance.cloud/desktop/appcast.xml`.
- DMG hosted at `https://loom.dissonance.cloud/desktop/LoomDesktop-<version>.dmg`.

Sparkle is not required for the first development build, but the scaffold should leave a clear integration point.

---

## Privacy and Permissions UX

macOS will require user approval for:

- Screen Recording.
- Camera.
- Microphone.

The app must include `Info.plist` usage descriptions and a permissions preflight screen.

Expected UX:

1. On first launch, show a setup checklist.
2. Request camera and microphone via AVFoundation.
3. Trigger ScreenCaptureKit permission flow.
4. If screen recording is denied, open System Settings to Privacy & Security -> Screen & System Audio Recording.
5. Explain that the app may need restart after permission changes.

This is a major product risk because macOS privacy permission prompts are outside the app's control.

---

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Apple Developer account cost (`~$99/year`) | Required for trusted distribution | Document upfront; development builds can run unsigned locally |
| ScreenCaptureKit permission UX | Users can get stuck in System Settings | Build a first-run permission checklist and detection flow |
| System audio capture behavior varies by macOS version | Recording may miss app audio | Pin minimum macOS version, test on Ian's M4 Pro first |
| Native capture/compositing complexity | Multi-week implementation | Keep v1 single-screen, 30fps, no editing |
| Backend auth expects cookies | Desktop cannot use browser cookies naturally | Add bearer-token support to existing auth helper |
| MP4 extension compatibility | Current backend keys default to `.webm` | Extend key selection by MIME type before desktop upload |
| Keeping web + desktop parity | Two clients can drift | Desktop remains record/upload only; web remains source of truth |
| Bubble coordinate mapping | Overlay position may not line up in exported video | Centralize `BubblePlacement` and add unit tests for coordinate transforms |
| Large local temp files | Long recordings consume disk | Store temp files in app cache, show disk usage, delete after successful upload |

---

## Acceptance Criteria for v1

- A signed-in user can launch the macOS app, pick a screen, camera, and mic, and start recording.
- A frameless draggable camera bubble floats over other apps while recording.
- The exported composite includes the camera bubble at the dragged position.
- Stop finalizes local files and uploads all available tracks through the existing multipart endpoints.
- The recording appears in the existing web dashboard under the signed-in user's account.
- Existing backend processing moves the recording to ready with transcript, AI outputs, thumbnail, and preview sprite.
- The share page plays the recording without a desktop-specific viewer path.
- No R2, Deepgram, Anthropic, Mailgun, or Supabase service-role secrets are shipped in the app.

## Open Questions for Build Phase

- Minimum macOS target: recommend macOS 14 for a cleaner ScreenCaptureKit/system-audio baseline unless Ian needs older-machine support.
- Default codec: recommend H.264/AAC MP4 for maximum web compatibility; HEVC can be an opt-in later.
- Default destination after upload: open edit page or copy share link. Recommend opening edit page for creator-first flow.
- Brand profile selection in desktop v1: optional. The API accepts `brandProfileId`; v1 can default null and let the web edit page assign brands.
