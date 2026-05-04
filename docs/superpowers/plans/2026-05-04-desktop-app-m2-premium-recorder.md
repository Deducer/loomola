# Desktop App M2 — Premium Recorder — Implementation Plan

**Date:** 2026-05-04
**Spec:** [`docs/superpowers/specs/2026-05-04-desktop-app-m2-premium-recorder-design.md`](../specs/2026-05-04-desktop-app-m2-premium-recorder-design.md)
**Status:** Ready to execute
**Style:** TDD-flavoured, one small slice at a time. Ship behind feature flags where reasonable so M1 paths stay green during the build.

This plan turns the desktop app from "early dev build" into "feels like the paid product." Composite writer first (it unblocks everything else), HUD second (highest visible polish payoff), source picker + permissions + menubar in parallel after that.

---

## Phase 0 — Foundations

These can be done first by anyone in any order. They unblock later phases without touching capture code.

### 1. Extract `RecorderStateMachine`

- **Files:** new `desktop/Sources/LoomDesktopApp/Models/RecorderStateMachine.swift`, edit `desktop/Sources/LoomDesktopApp/UI/RecorderViewModel.swift`.
- **Goal:** centralize the existing 10-case `RecorderState` transition logic (currently scattered through async closures in the 674-line view model) into a single `apply(_ event: RecorderEvent) -> RecorderState` function. This is a refactor; behavior should not change.
- **Tests:** `desktop/Tests/LoomDesktopTests/RecorderStateMachineTests.swift`. Cover: `signedInIdle → preparingPermissions → readyToRecord → recording → finalizing → uploading → complete → signedInIdle`. Cover invalid transitions: `signedInIdle → finalizing` (rejected), `recording → readyToRecord` (rejected), pause from non-recording (rejected).
- **Acceptance:** all M1 flows still work; new tests cover ≥ 8 transitions.

### 2. `BubblePlacement` model + coordinate-mapping tests

- **Files:** new `desktop/Sources/LoomDesktopApp/Models/BubblePlacement.swift`, tests in `desktop/Tests/LoomDesktopTests/BubblePlacementTests.swift`.
- **Goal:** pure-data model that holds the bubble's screen-coordinate frame, shape (circle / rounded-rect), and the math to project it into captured-pixel coordinates given a target `(displayOriginPx, displayWidthPx, displayHeightPx, backingScaleFactor)`.
- **Tests:** 1× display, 2× Retina display, multi-display with primary on the right, bubble dragged off-display (clamped), bubble at exact corner, circle vs rectangle shape mapping, AppKit-y vs CGImage-y flip.
- **Acceptance:** ≥ 6 unit tests pass; `BubbleOverlayWindowController` can construct a `BubblePlacement` from its panel frame.

### 3. Add `BubblePositionController` shared ref

- **Files:** new `desktop/Sources/LoomDesktopApp/Capture/BubblePositionController.swift`.
- **Goal:** thread-safe `Atomic<BubblePlacement?>` (use `OSAllocatedUnfairLock` or `Atomic<>` from Swift 6) shared between the bubble overlay window and the future compositor. Mirrors the web app's `BubblePositionController` pattern (`src/lib/recording/bubble-position-controller.ts`).
- **Tests:** trivial (unit test reads/writes from concurrent tasks).
- **Acceptance:** `BubbleOverlayWindowController` writes to the controller on drag; nobody reads from it yet.

---

## Phase 1 — Composite writer (the unblocker)

This phase is the biggest engineering slice. Land it as one branch but in small commits — splitting it makes the fail/recover loops fast.

### 4. Switch `ScreenCaptureCoordinator` from `SCRecordingOutput` to a `CMSampleBuffer` consumer

- **Files:** edit `desktop/Sources/LoomDesktopApp/Capture/ScreenCaptureCoordinator.swift`.
- **Goal:** keep an MP4-emitting fallback path (the current `startFirstDisplayRecording` method, in case M2 misses), but add a parallel `startSampleBufferCapture(sourceID: CGDirectDisplayID, output: SCStreamOutput) async throws` method that delivers raw `.screen` and `.audio` sample buffers to a caller — no embedded `SCRecordingOutput`.
- **Acceptance:** unit test with a mock `SCStream` (or a manual test on Ian's M4 Pro) confirms ≥ 60 frames arrive in 2 s, valid PTS, valid pixel buffers.

### 5. Add `CameraCaptureCoordinator`

- **Files:** new `desktop/Sources/LoomDesktopApp/Capture/CameraCaptureCoordinator.swift`.
- **Goal:** start an `AVCaptureSession` with the chosen camera as `AVCaptureVideoDataOutput`. Deliver `CMSampleBuffer` to a delegate. Also expose the live `AVCaptureVideoPreviewLayer` for the overlay panel preview (single source — avoids running the camera twice).
- **Notes:** the existing M1 bubble overlay creates its own preview layer; refactor it to consume the new coordinator's output.
- **Acceptance:** previewing in the bubble overlay still works; sample buffers arrive at ≥ 25 fps on a 30 fps camera.

### 6. Add `MicrophoneCaptureCoordinator` & `SystemAudioCaptureCoordinator` parity

- **Files:** edit `desktop/Sources/LoomDesktopApp/Capture/MicrophoneCaptureCoordinator.swift`, edit `desktop/Sources/LoomDesktopApp/Capture/SystemAudioCaptureCoordinator.swift`.
- **Goal:** ensure both coordinators expose a `CMSampleBuffer`-delivering delegate API, not just file-writing. Add accessors if missing.
- **Acceptance:** tests assert each delivers buffers at the expected rate; existing audio-note path still writes to `AudioAssetWriter` unchanged.

### 7. Implement `CompositeRecorder` for video + audio

- **Files:** edit `desktop/Sources/LoomDesktopApp/Capture/CompositeRecorder.swift`.
- **Goal:** real `AVAssetWriter` writing H.264/AAC MP4 to `composite.mp4`.
- **Sketch:**
  ```swift
  let writer = try AVAssetWriter(outputURL: ..., fileType: .mp4)
  let videoInput = AVAssetWriterInput(mediaType: .video, outputSettings: [
      AVVideoCodecKey: AVVideoCodecType.h264,
      AVVideoWidthKey: outWidth,
      AVVideoHeightKey: outHeight,
      AVVideoCompressionPropertiesKey: [
          AVVideoAverageBitRateKey: 8_000_000,  // tunable
          AVVideoMaxKeyFrameIntervalKey: 60,
      ]
  ])
  videoInput.expectsMediaDataInRealTime = true
  let pixelAdaptor = AVAssetWriterInputPixelBufferAdaptor(
      assetWriterInput: videoInput,
      sourcePixelBufferAttributes: [
          kCVPixelBufferPixelFormatTypeKey: kCVPixelFormatType_32BGRA,
          kCVPixelBufferWidthKey: outWidth,
          kCVPixelBufferHeightKey: outHeight,
      ]
  )
  let audioInput = AVAssetWriterInput(mediaType: .audio, outputSettings: ...)
  audioInput.expectsMediaDataInRealTime = true
  ```
- **Frame loop (`appendScreenFrame`):**
  1. Pull latest camera `CVPixelBuffer` (cached from `CameraCaptureCoordinator`).
  2. Read current `BubblePlacement` from controller.
  3. Compose into a destination pixel buffer using `CIContext.render(_:to:bounds:)` with a layered `CIFilter` chain (source-over compositing of camera-as-circle on top of screen).
  4. `pixelAdaptor.append(_, withPresentationTime:)` at the screen frame's PTS.
- **Audio loop:** mix mic + system audio (`AVMutableComposition` is overkill; a hand-rolled `AVAudioEngine` mixer or pre-mix at sample-buffer level via `AVAudioConverter` is fine). Append to `audioInput`.
- **Tests:** integration test on a recorded fixture (5 s of synthetic screen + camera) — output MP4 plays, has expected duration, contains visible bubble.
- **Acceptance:** a 10 s composite MP4 plays in QuickTime; bubble visible at the dragged location; audio mixed.

### 8. Pause/resume timestamp arithmetic

- **Files:** `Capture/CompositeRecorder.swift`.
- **Goal:** when paused, stop appending samples. On resume, subtract `(resumeAt - pausedAt)` from incoming PTS so the asset timeline has no gap.
- **Tests:** unit test simulates pause-resume across 100 frames and asserts monotonically increasing PTS with no time gap > 1 frame.
- **Acceptance:** a record-pause-resume-stop cycle produces a playable MP4 with audio in sync.

### 9. Raw-track writers (best effort)

- **Files:** new `desktop/Sources/LoomDesktopApp/Capture/RawTrackRecorders.swift`.
- **Goal:** write `screen.mp4`, `camera.mp4`, `mic.m4a`, `system-audio.m4a` in parallel with the composite. Each is its own `AVAssetWriter`. They consume the same upstream sample buffers (each coordinator multicasts to the composite + the raw writer).
- **Note:** if performance is tight, defer raw-track writers to M3 — composite-only is shippable. Mark this as deferrable in the PR.
- **Acceptance:** raw tracks play individually in QuickTime; web-app per-track download flow still works.

### 10. Wire compositor into `RecorderViewModel`

- **Files:** edit `desktop/Sources/LoomDesktopApp/UI/RecorderViewModel.swift`.
- **Goal:** when `state == .recording` and the user has chosen video mode, instantiate `CompositeRecorder` + camera + mic + system-audio coordinators, hook delegates, route sample buffers, write to disk.
- **Acceptance:** end-to-end record on Ian's M4 Pro produces a `composite.mp4` with the bubble.

---

## Phase 2 — Recording HUD

### 11. `RecordingHUDWindowController`

- **Files:** new `desktop/Sources/LoomDesktopApp/UI/RecordingHUDWindowController.swift`, possibly `UI/RecordingHUDView.swift`.
- **Goal:** floating `NSPanel` mirroring `AudioRecordingWindowController` shape: 280 × 56 pt pill, top-center default, draggable, `sharingType = .none`, `level = .floating`, `collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient]`.
- **Contents:** red recording dot (subtle pulse, `prefers-reduced-motion` respected), `REC` label, mono-digit elapsed timer driven by `TimelineView(.periodic(...))`, mic level bars (reuse `AudioLevelBars`), pause/resume button, stop button, discard button.
- **State:** ObservableObject mirroring `AudioRecordingWindowState` pattern.
- **Tests:** snapshot test or `XCUITest`-style unit verifying state changes propagate to UI.
- **Acceptance:** during a video recording, the HUD appears, the timer increments, the mic level moves, stop ends the recording.

### 12. HUD self-check (anti-recursion)

- **Files:** `Capture/CompositeRecorder.swift`.
- **Goal:** sanity-check that `sharingType = .none` actually keeps the HUD out of the captured pixels. After 1 s of capture, sample one screen frame and look for the HUD's distinctive red-dot pixel signature in its expected position. Log a warning if found.
- **Acceptance:** warning never fires during normal capture on Ian's M4 Pro.

### 13. HUD auto-fade

- **Files:** `RecordingHUDView.swift`.
- **Goal:** after 5 s of cursor inactivity (mouse not over HUD bounds), fade to ~50 % opacity. Restore on hover.
- **Acceptance:** observable manually; not unit-tested.

---

## Phase 3 — Source picker

### 14. Replace `CaptureSourcesView` with a real picker

- **Files:** edit `desktop/Sources/LoomDesktopApp/UI/MainRecorderView.swift`, possibly new `UI/SourcePickerView.swift`.
- **Goal:** trigger Apple's `SCContentSharingPicker` (macOS 14+). Show a "current source" pill that reads "Display 1 — 3024 × 1964" or "Window — Safari · Apple Developer" with a small thumbnail.
- **API:**
  ```swift
  let picker = SCContentSharingPicker.shared
  picker.isActive = true
  picker.maximumStreamCount = 1
  picker.add(self)  // SCContentSharingPickerObserver
  picker.present()
  ```
- **Persistence:** remember the user's last choice in `UserDefaults` keyed by `cloud.dissonance.loom.desktop.lastSource`.
- **Acceptance:** picker opens, user selects a window, the chosen window's name appears in the pill, recording captures that window.

### 15. Camera + mic dropdowns

- **Files:** edit `MainRecorderView.swift`, possibly extract `UI/DeviceDropdowns.swift`.
- **Goal:** `Picker` views populated from `AVCaptureDevice.DiscoverySession(deviceTypes:..., mediaType: .video, position: .unspecified)` (and equivalent for `.audio`). Persist last choice.
- **Acceptance:** changing the picker changes which device the recorder uses on next start.

### 16. System audio toggle, brand picker, folder picker

- **Files:** edit `MainRecorderView.swift`.
- **Goal:** "Include system audio" checkbox, brand profile dropdown (fetched from `BackendClient`'s new `/api/brands` call), folder dropdown (new `/api/folders` call). Both stamped on `media_objects` at `/start` time.
- **Backend work:** if those endpoints don't already accept bearer tokens, that's part of the security pack (see security plan). Verify before starting.
- **Acceptance:** brand and folder fields land on the created `media_objects` row.

---

## Phase 4 — Permissions preflight

### 17. `PermissionChecker`

- **Files:** new `desktop/Sources/LoomDesktopApp/Capture/PermissionChecker.swift`.
- **Goal:** synchronous status check + async request methods for camera, mic, screen recording, accessibility. Returns a `Permissions` struct (`.granted | .denied | .notDetermined` per permission).
- **Tests:** trivial — most paths require manual verification.
- **Acceptance:** `Permissions().isReady` is true on a freshly-granted machine.

### 18. `PermissionsView`

- **Files:** new `desktop/Sources/LoomDesktopApp/UI/PermissionsView.swift`.
- **Goal:** SwiftUI checklist with status pill per row, "Request" / "Open System Settings" buttons. Re-checks on `NSWindow.didBecomeKeyNotification`.
- **Deep-link URLs:** see spec § 4. Open via `NSWorkspace.shared.open`.
- **Acceptance:** denying camera then re-opening Settings → granting → coming back to the app updates the row to ✅.

### 19. Block "Start recording" until preflight is green

- **Files:** edit `RecorderViewModel.swift`, `MainRecorderView.swift`, recording HUD popover.
- **Goal:** wire `PermissionChecker.isReady` into the state machine. Disable / hide the start button when not ready; show a banner pointing to PermissionsView.
- **Acceptance:** with screen recording denied, the start button is disabled with an inline "Grant screen recording" link.

### 20. First-run trigger

- **Files:** `LoomDesktopApp.swift` or `AppDelegate.swift`.
- **Goal:** show `PermissionsView` on first launch (detected via `UserDefaults` flag). Subsequent launches skip unless explicitly opened from Settings.
- **Acceptance:** clearing the flag and relaunching shows the preflight.

---

## Phase 5 — Menubar quick-record + global hotkey

### 21. State-aware menubar icon

- **Files:** edit `desktop/Sources/LoomDesktopApp/App/AppDelegate.swift`.
- **Goal:** swap the static "Loom" label for an `NSImage` icon that reflects state: idle (outline circle), recording (filled red, blinking), paused (filled yellow), uploading (progress ring around upload arrow). Use SF Symbols where available; ship as image assets otherwise.
- **Recording elapsed timer in the status bar:** `00:42` rendered next to the icon while recording.
- **Acceptance:** the menubar reflects state in real time.

### 22. `NSPopover` quick-record

- **Files:** new `desktop/Sources/LoomDesktopApp/UI/MenubarPopoverView.swift`, edit `AppDelegate.swift` to host the popover.
- **Goal:** a SwiftUI popover that opens on icon click. Contents per spec § 5.
- **Acceptance:** clicking the menubar icon opens the popover; clicking "Start recording" starts a recording without opening the main window.

### 23. Global hotkey

- **Files:** new `desktop/Sources/LoomDesktopApp/App/GlobalHotkey.swift`.
- **Goal:** Carbon-based hotkey registration via `RegisterEventHotKey`. Default `⌥⇧L` toggles record. Wrap in a small Swift class that publishes events to the view model.
- **Tests:** trivial; manual verification.
- **Acceptance:** pressing the hotkey while idle starts a recording; pressing again stops it.

### 24. Settings window

- **Files:** new `desktop/Sources/LoomDesktopApp/UI/SettingsView.swift`. Wire as a SwiftUI `Settings { }` scene.
- **Goal:** hotkey re-binding, default save location, default capture resolution, sign out, About.
- **Acceptance:** changing the hotkey from `⌥⇧L` to `⌥⇧R` works on next press.

---

## Phase 6 — End-to-end smoke

### 25. Manual M2 smoke checklist

- **Files:** edit `desktop/README.md`.
- **Run on Ian's M4 Pro:**
  - Sign in (still works from M1).
  - First-launch permissions preflight grants all four.
  - Click menubar icon → popover opens → click Start recording → 3-2-1 → recording starts.
  - HUD appears top-center, timer runs, mic meter moves.
  - Drag bubble; observe live preview tracks.
  - Stop from HUD.
  - Composite uploads to dashboard; bubble visible in exported video.
  - Repeat with: window source instead of display; non-default camera; system audio off.
  - Press `⌥⇧L` while another app has focus → recording starts.
  - Pause / resume cycle produces in-sync output.

### 26. Update CLAUDE.md + AGENTS.md + ROADMAP.md

- **Files:** `CLAUDE.md`, `AGENTS.md`, `ROADMAP.md`.
- **Goal:** mark Desktop M2 shipped, update the desktop section's known caveats, list out-of-scope items for M3.
- **Acceptance:** roadmap entry exists; CLAUDE.md desktop bullet reflects new reality.

---

## Build notes for the next agent

- **Order matters.** Phase 0 unblocks all later work. Phase 1 must land before Phase 2's HUD has anything to show. Phases 3, 4, 5 are independent of each other after Phase 1 — feel free to parallelize commits.
- **Feature flag.** Keep the M1 path (`startFirstDisplayRecording` via `SCRecordingOutput`) callable behind a `useM1Path: Bool` debug toggle until Phase 1 is fully tested. Lets you bisect regressions fast.
- **Don't rewrite `RecorderViewModel.swift`.** It's 674 lines and battle-tested. Extract a state machine, but resist the temptation to rewrite.
- **Bubble compositing.** The bubble can be circle or rounded-rect. The shape lives in `BubblePlacement.shape`. Compositor branches on shape (CIFilter mask geometry).
- **Performance budget.** On Ian's M4 Pro, target 30 fps composite at 1440p, < 25 % CPU, < 1 GB resident memory. If you blow past this, profile with Instruments before adding features.
- **Test fixtures.** A 5 s synthetic screen + camera capture (use `AVAssetWriter` to make a known-good MP4 at build time) is the easiest way to test the compositor without recording every iteration.
- **The pre-existing `tests/unit/ai-schemas.test.ts > rejects negative timestamps` failure is unrelated.** Don't touch it.
- **macOS 15 vs 14.** M1 spec settled on 14. Keep that floor unless `SCContentSharingPicker` or another API genuinely requires 15.
- **Audio sample-buffer mixing is the trickiest part of Phase 1.** If `AVAudioEngine` mixing complicates the asset writer, fall back to writing mic-only to the composite audio track and including the raw `system-audio.m4a` in raw track uploads. Document the tradeoff.

---

## Out of scope (push to M3)

- Region selection (drag-rectangle).
- Multi-display capture.
- HEVC encoder option in Settings.
- Recent recordings in the menubar popover.
- Per-action keyboard shortcuts.
- On-screen drawing / annotation during recording.
- Signed release DMG + notarization + Sparkle.
- Sound effect on record start/stop.
