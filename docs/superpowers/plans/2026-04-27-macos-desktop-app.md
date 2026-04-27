# Loom Clone macOS Desktop App — Implementation Plan

**Date:** 2026-04-27  
**Spec:** [`docs/superpowers/specs/2026-04-27-macos-desktop-app-design.md`](../specs/2026-04-27-macos-desktop-app-design.md)  
**Status:** Ready to execute  
**Style:** TDD-flavoured, one small slice at a time

This plan intentionally keeps the desktop app as a record-and-upload client. The web app remains the source of truth for metadata, processing, share pages, comments, brands, and analytics.

## Phase 0 — Backend Compatibility Checks

1. **Add bearer-token support to server auth**
   - Files: `src/lib/require-auth.ts`, `src/lib/supabase/server.ts` if needed.
   - Add a helper that checks `Authorization: Bearer <jwt>` before falling back to cookie auth.
   - Acceptance: a unit/integration test proves `POST /api/recordings/start` works with a valid Supabase JWT and no browser cookie.

2. **Teach upload keys to respect MIME type**
   - File: `src/app/api/recordings/start/route.ts`.
   - Current browser path can keep `.webm`; desktop MP4 should get `.mp4` / `.m4a`.
   - Code sketch:
     ```ts
     function extensionForMime(mimeType: string): "webm" | "mp4" | "m4a" {
       if (mimeType.startsWith("video/mp4")) return "mp4";
       if (mimeType.startsWith("audio/mp4")) return "m4a";
       return "webm";
     }
     ```
   - Acceptance: existing web test fixtures still produce `.webm`; desktop-shaped request produces MP4/M4A keys.

3. **Add desktop-shaped API route tests**
   - Files: `tests/unit` or a new API-focused test near existing route tests.
   - Test track kinds: `composite`, `screen`, `camera`, `mic`, `system-audio`.
   - Acceptance: request/response schema matches the desktop client's `StartRecordingResponse`.

## Phase 1 — Xcode Project Foundation

4. **Create a real Xcode app target from the SwiftPM scaffold**
   - Files: `desktop/Package.swift`, `desktop/App/Info.plist`, `desktop/App/LoomDesktop.entitlements`.
   - Recommended bundle id: `cloud.dissonance.loom.desktop`.
   - Minimum macOS: 14.0 unless Ian requires older support.
   - Acceptance: Xcode opens the project/target and runs an empty app window.

5. **Wire app lifecycle and menu bar**
   - Files: `desktop/Sources/LoomDesktopApp/App/LoomDesktopApp.swift`, `desktop/Sources/LoomDesktopApp/App/AppDelegate.swift`.
   - Add `NSStatusItem` with Start Recording, Open Dashboard, Sign Out, Quit.
   - Acceptance: app launches as a menu bar app and can open the main recorder window.

6. **Add baseline UI state tests**
   - Files: `desktop/Tests/LoomDesktopTests/RecorderStateTests.swift`.
   - Test allowed transitions: idle -> preparing -> recording -> finalizing -> uploading -> complete.
   - Acceptance: invalid transitions are rejected or ignored predictably.

## Phase 2 — Authentication

7. **Implement Keychain session storage**
   - Files: `desktop/Sources/LoomDesktopApp/Auth/KeychainSessionStore.swift`.
   - Store access token, refresh token, expiry.
   - Acceptance: unit tests can write/read/delete a fake session using a test service name.

8. **Implement Supabase email/password sign-in**
   - Files: `desktop/Sources/LoomDesktopApp/Auth/SupabaseAuthClient.swift`, UI sign-in view.
   - Use `supabase-swift`.
   - Acceptance: manual dev login works against the existing Supabase project using Ian's creator account.

9. **Add session refresh on launch**
   - Files: `AuthSessionStore`, `LoomDesktopApp.swift`.
   - Acceptance: relaunching the app does not force sign-in when refresh token is valid.

10. **Optional magic-link callback**
   - Files: Xcode URL scheme settings, auth client callback handler.
   - URL scheme: `loomclone://auth/callback`.
   - Acceptance: magic link can open the app and create a session. If this delays v1, leave email/password as MVP.

## Phase 3 — Permissions and Capture Setup

11. **Build first-run permission checklist**
   - Files: `desktop/Sources/LoomDesktopApp/UI/PermissionsView.swift`, `Capture/PermissionChecker.swift`.
   - Cover camera, mic, screen recording.
   - Acceptance: denied permissions show a clear action to open System Settings.

12. **List capturable displays/windows**
   - Files: `Capture/ScreenCaptureCoordinator.swift`.
   - Use ScreenCaptureKit shareable content.
   - Acceptance: UI shows available displays/windows on Ian's M4 Pro.

13. **Start single-display screen capture**
   - Files: `Capture/ScreenCaptureCoordinator.swift`.
   - Capture frames at 30fps.
   - Acceptance: frames arrive and basic stats display in debug UI.

14. **Start camera preview/capture**
   - Files: `Capture/CameraCaptureCoordinator.swift`.
   - Use AVFoundation.
   - Acceptance: selected camera preview appears in main window and bubble overlay.

15. **Start mic + system audio capture**
   - Files: `Capture/AudioCaptureCoordinator.swift`.
   - Mic via AVFoundation; system audio via ScreenCaptureKit.
   - Acceptance: local debug meters move for mic and system audio separately.

## Phase 4 — Bubble Overlay and Compositing

16. **Implement transparent draggable bubble panel**
   - Files: `UI/BubbleOverlayWindowController.swift`.
   - Use `NSPanel`, clear background, no titlebar, always on top.
   - Acceptance: bubble floats over other apps and can be dragged smoothly.

17. **Centralize bubble placement math**
   - Files: `Models/BubblePlacement.swift`, tests in `desktop/Tests/LoomDesktopTests/BubblePlacementTests.swift`.
   - Convert overlay window coordinates into captured video coordinates.
   - Acceptance: tests cover Retina scaling, display origin offsets, and clamping inside video bounds.

18. **Implement composite writer**
   - Files: `Capture/CompositeRecorder.swift`.
   - Use `AVAssetWriter` for H.264/AAC MP4.
   - Render screen frame + camera frame into one pixel buffer.
   - Acceptance: a 10s local composite MP4 plays in QuickTime with bubble visible.

19. **Implement raw track writers**
   - Files: `Capture/RawTrackRecorder.swift`.
   - Outputs: screen MP4, camera MP4, mic M4A, system-audio M4A when available.
   - Acceptance: raw files are created and playable individually.

20. **Pause/resume behavior**
   - Files: capture coordinators, recorder state model.
   - Acceptance: paused time is not included in final duration or media timeline drift is documented and handled.

## Phase 5 — Upload Client

21. **Implement backend client models**
   - Files: `Upload/BackendClient.swift`, `Models/TrackKind.swift`.
   - Match `/api/recordings/start`, `part-url`, `complete`, `abort`.
   - Acceptance: unit tests encode/decode sample JSON from the web API.

22. **Implement multipart upload coordinator**
   - Files: `Upload/MultipartUploadCoordinator.swift`.
   - 8MB part size to match the web upload coordinator.
   - Upload each part with URLSession `PUT`.
   - Capture `ETag` headers exactly.
   - Acceptance: unit tests split sample data into expected part counts; integration test uploads to a mocked local HTTP server.

23. **Upload real desktop recording**
   - Files: recorder orchestration view model.
   - Start backend row before recording, upload files after stop, then call complete.
   - Acceptance: a desktop-created recording appears in the existing web dashboard.

24. **Abort and recovery**
   - Files: upload coordinator, UI error handling.
   - On capture setup failure after `start`, call `/abort`.
   - On upload failure, keep local files and offer retry.
   - Acceptance: forced network failure leaves retryable local files and does not leak an endless uploading row.

## Phase 6 — Packaging and Release

25. **Prepare signing settings**
   - Files: Xcode project, `desktop/README.md`.
   - Bundle id: `cloud.dissonance.loom.desktop`.
   - Enable Hardened Runtime.
   - Acceptance: local Developer ID archive signs successfully once Apple Developer credentials are available.

26. **Create DMG release script**
   - Files: `desktop/scripts/package-dmg.sh`.
   - Use `xcodebuild archive`, `create-dmg` or `hdiutil`, `codesign`, `notarytool`, `stapler`.
   - Acceptance: unsigned dev DMG can be produced locally; signed/notarized path documented.

27. **Add Sparkle**
   - Files: Package/Xcode dependencies, appcast hosting docs.
   - Acceptance: app can check a dev appcast and report no update.

28. **Manual MVP smoke test**
   - Files: `desktop/README.md` checklist.
   - Run on Ian's M4 Pro:
     - sign in
     - grant permissions
     - record 30s screen + camera + mic + system audio
     - upload
     - confirm dashboard card
     - confirm share page playback
     - confirm transcript and AI outputs arrive

## Build Notes for the Next Agent

- Start with tasks 1 and 2 before investing deeply in native upload. Bearer auth and MP4 key extensions are the only expected backend compatibility work.
- Keep the desktop app thin. Any temptation to add comments, brand CRUD, editing, or AI UI belongs in the web app.
- Prefer boring H.264/AAC MP4 first. WebM from Swift is possible only with extra libraries and is not worth the v1 complexity.
- Do not ship secrets in the app. The Mac receives only Supabase public URL/anon key and user tokens.
- The existing failing `tests/unit/ai-schemas.test.ts > rejects negative timestamps` test is unrelated to this project and should remain untouched unless Ian separately asks for it.
