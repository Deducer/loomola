# Desktop App M2 — Premium Recorder

**Author:** Claude Opus 4.7
**Date:** 2026-05-04
**Status:** Spec'd, ready to plan + build
**Related plan:** [`docs/superpowers/plans/2026-05-04-desktop-app-m2-premium-recorder.md`](../plans/2026-05-04-desktop-app-m2-premium-recorder.md)
**Predecessor spec:** [`docs/superpowers/specs/2026-04-27-macos-desktop-app-design.md`](2026-04-27-macos-desktop-app-design.md) (the M1 desktop app — built but only ~60% to premium parity)

---

## Why this milestone

The desktop app is the highest-leverage gap to "premium feel" right now. M1 shipped the backend integration (auth, source enumeration, single-display recording via `SCRecordingOutput`, audio note flow, Obsidian sync, meeting detection). What it does **not** ship is the experience users associate with Loom / CleanShot X / Screen Studio:

- **The bubble is not in the export.** `desktop/Sources/LoomDesktopApp/Capture/CompositeRecorder.swift` is a stub (placeholder `appendFramePlaceholder`, empty `finish`). The user sees themselves on screen during recording but the exported MP4 is "naked." This is the single most visible gap.
- **No on-screen recording HUD for video.** Audio mode has a polished floating panel (`AudioRecordingWindowController`), video mode has none — once recording starts the user has no on-screen indicator of state, no stop button, no elapsed time. They have to find the main window.
- **No source picker.** `MainRecorderView.swift` shows sources read-only (lines 603–622); the recorder hard-codes "first display" via `ScreenCaptureCoordinator.startFirstDisplayRecording`. There is no way to pick which display, which window, or which app — every competitor has this.
- **No permissions preflight.** `Info.plist` strings exist but there is no `PermissionsView`. Camera prompts surface only when the bubble first appears; screen recording and mic only error at start. First-run UX is "guess and hope" rather than "we'll walk you through it."
- **Menubar is a label, not an entry point.** `AppDelegate.configureMenuBar()` puts a static "Loom" string and a basic submenu. Loom's menubar is the primary surface — click → popover with a giant "Record" button + source/cam/mic choices. Right now you have to bring the main window to front to do anything.

Closing these five gaps takes the desktop app from "early dev build" to "feels like the paid product." The composite writer is a prerequisite for everything else — once the `AVAssetWriter` pipeline exists, bubble compositing is its natural extension, raw-track writers are siblings, and pause/resume becomes feasible.

## Goals

- The exported composite MP4 includes the camera bubble at the live, dragged position.
- The user always knows recording is happening and can stop it from one click on screen, regardless of which app has focus.
- The user can choose which display, window, or app to record before pressing record, and which camera + mic to use.
- First launch walks the user through camera, microphone, screen recording, and accessibility permissions, deep-linking to System Settings on miss.
- Starting a recording takes one click from the menubar (or one keyboard shortcut), without going through the main window.
- The pipeline is built on `AVAssetWriter` rather than `SCRecordingOutput`, so future work (HEVC, custom bitrate, raw track writers, pause/resume, region capture) has a clear path.

## Non-goals (explicit fence)

- **Multi-display capture.** Pick one display OR one window OR one app per recording.
- **Region selection (drag-rectangle).** Default to whole-display / whole-window. A region-picker is a follow-up.
- **In-app editing.** Trim, blur, crop, drawing — still web-side.
- **HEVC / ProRes / custom encoder UI.** v1 stays H.264/AAC. Encoder is configurable in code; not yet exposed in Settings.
- **Multi-camera or multi-mic recording.** One of each.
- **Annotations / on-screen drawing during recording.** Different product slice.
- **Signed release build / DMG / Sparkle.** Tracked separately; can ship M2 from local-built dev DMG.
- **Mac App Store distribution.** Same answer as M1 spec.

---

## Feature set

### 1. Composite writer (the unblocker)

Replace `CompositeRecorder` with a real `AVAssetWriter`-based pipeline.

**Inputs:**

- Screen frames as `CMSampleBuffer` from `SCStream` (already wired in `ScreenCaptureCoordinator`; switch from `SCRecordingOutput` to a custom `SCStreamOutput` consumer).
- Camera frames as `CMSampleBuffer` from `AVCaptureVideoDataOutput` (new `CameraCaptureCoordinator`).
- Mic frames as `CMSampleBuffer` from `AVCaptureAudioDataOutput`.
- System audio as `CMSampleBuffer` from `SCStream` audio output.

**Pipeline per frame:**

1. Take the latest screen `CVPixelBuffer`.
2. Take the latest camera `CVPixelBuffer` (cached; camera is typically 30 fps so most screen frames will reuse).
3. Read current `BubblePlacement` from a thread-safe `BubblePositionController` (analogous to the web-app one — see `src/lib/recording/bubble-position-controller.ts`).
4. Render screen + camera-as-mask onto a single output `CVPixelBuffer` using `CIContext` + `CIFilter` chain:
   - `CISourceOverCompositing` for the bubble layer onto the screen.
   - `CIRoundedRectangleStrokedGenerator` or a static circle mask for the bubble shape (circle / rounded-rect, mirroring web-app shapes).
5. Append the result to the composite `AVAssetWriterInput` (video) at the screen frame's PTS.
6. Append mic + system-audio sample buffers (mixed) to the audio `AVAssetWriterInput`.

**Audio mixing:** mix mic and system-audio mono streams into a single stereo (or mono) audio track. Reuse the pattern from `AudioAssetWriter` / `AudioNoteRecorder`. For raw track upload, also write mic and system-audio as separate `AVAssetWriter` instances.

**Output:** `composite.mp4` written to a per-recording temp dir, plus optional raw `screen.mp4` / `camera.mp4` / `mic.m4a` / `system-audio.m4a` (raw tracks are best-effort; ship if straightforward, defer if expensive).

**Coordinate mapping (`BubblePlacement`):** the bubble overlay's `NSPanel` lives in screen coordinates with the AppKit y-up convention. `SCStream` captures pixels with the top-left origin convention. Mapping has to:

- Translate the panel's screen origin to the captured display's origin (multi-display offset).
- Flip y so panel-bottom-left becomes pixel-top-left.
- Scale by the display's `backingScaleFactor` (Retina) — `SCStream` reports `width/height` in pixels, not points.
- Clamp the destination rect so a bubble dragged off-display still composites into the captured area without crashing.

This logic must live in `Models/BubblePlacement.swift` with unit tests covering: 1× display, 2× Retina display, multi-display with primary on the right, bubble dragged off-display, bubble at exact corner, circle vs rectangle shape.

**Frame rate & sync:** screen runs at 30 fps; camera at whatever the device delivers (often 30 fps too). Use the screen frame PTS as the master clock. Camera frames are sampled at appendence time, not their own PTS — this introduces up to ~33 ms of jitter, acceptable for v1. If lipsync drift becomes visible, add a secondary master-clock pass.

**Why CIContext, not Metal directly:** `CIContext.render(_:to:)` to a `CVPixelBuffer` is GPU-backed, well-tested, integrates with `AVAssetWriter`'s pixel-buffer adaptor, and avoids hand-writing Metal kernels. Performance budget on M4 Pro is fine — measured Apple guidance says 4K composite at 30 fps fits comfortably.

### 2. Recording HUD

A floating `NSPanel` analogous to `AudioRecordingWindowController` but for video recording.

**Visual:** small horizontal pill (~280 × 56 pt) docked top-center by default, draggable. Layout:

```
┌─────────────────────────────────────────────┐
│  ●  REC  00:42   ▮▮▮▮▯ mic   ⏸  ◼  ✕      │
└─────────────────────────────────────────────┘
```

- **Red recording dot** (subtle pulse, respects `prefers-reduced-motion`).
- **`REC` + elapsed timer** (mono digits).
- **Mic level meter** (5 bars, same component as the audio HUD's `AudioLevelBars`).
- **Pause / resume** button.
- **Stop** button (primary, red on hover).
- **Discard** button (secondary, asks for confirmation).

**Behavior:**

- Always on top, hides on the recorded display(s) — uses `NSWindow.sharingType = .none` so the HUD itself never appears in the captured pixels (no recursion).
- Click-through is off (so the buttons are operable).
- Draggable by the empty-area background, snaps to top-center / top-left / top-right edges with a small magnetic threshold.
- During pause, the dot turns yellow and the timer freezes.
- Auto-fades to ~50 % opacity after 5 s of cursor inactivity; restores on hover.

**Implementation:** `UI/RecordingHUDWindowController.swift`, mirroring `AudioRecordingWindowController` line-for-line where possible. Internal state via a `@MainActor`-isolated `ObservableObject` that the `RecorderViewModel` writes to.

### 3. Source picker

Replace the read-only sources list with a real picker, surfaced two places:

- **Inline picker** in the main recorder window (replaces the current `CaptureSourcesView`).
- **Compact picker** in the menubar popover (next feature).

**Implementation choice:** use Apple's system picker — `SCContentSharingPicker` (macOS 14+). It gives:

- Live thumbnails for displays, windows, apps.
- Apple-native search and filtering.
- Familiar UX (matches the macOS screenshot tool and other apps users know).
- Built-in handling of multi-display, hidden windows, app icons.

We add a custom triggering button (because the system picker only opens via user action) and a small "current source" pill that shows the chosen display/window's name. If `SCContentSharingPicker` proves limiting on macOS 14, fall back to a custom grid backed by `SCShareableContent.current` thumbnails.

**Camera + mic pickers:** dropdowns next to the source pill, populated from `AVCaptureDevice.DiscoverySession`. Remember the last choice across launches in `UserDefaults`.

**System audio toggle:** explicit checkbox "Include system audio" — clarifies what's being recorded.

**Brand profile picker:** dropdown that lists the user's brand profiles (fetched from the existing API), stamped on `media_objects` at recording-start time. Optional; defaults to none.

**Folder picker:** same — pick which folder to drop the recording into. Defaults to "All recordings".

### 4. Permissions preflight

A `PermissionsView` that runs on first launch and on demand from Settings.

**Permissions covered:**

| Permission | API | Why |
|---|---|---|
| Camera | `AVCaptureDevice.requestAccess(for: .video)` | Bubble + camera-only mode |
| Microphone | `AVCaptureDevice.requestAccess(for: .audio)` | Mic capture |
| Screen Recording | `CGRequestScreenCaptureAccess()` + `CGPreflightScreenCaptureAccess()` | Screen + system audio |
| Accessibility | `AXIsProcessTrustedWithOptions` | Global hotkey detection |

**UX:**

1. Checklist with status pill per row: ⚪ not requested · ✅ granted · ⚠️ denied.
2. "Request" button that triggers the system prompt for permissions in `notDetermined` state.
3. "Open System Settings" deep-link for permissions in `denied` state, using URL schemes:
   - Screen recording: `x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture`
   - Microphone: `x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone`
   - Camera: `x-apple.systempreferences:com.apple.preference.security?Privacy_Camera`
   - Accessibility: `x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility`
4. Toast / banner explaining "macOS may need an app restart after granting screen recording" when the screen-recording state flips to granted mid-session — `CGPreflightScreenCaptureAccess` does not always reflect a fresh grant until relaunch.
5. Re-checks status when the window regains focus.

**Skip behavior:** the user can dismiss the preflight; the app records what it has permission for and surfaces an inline error for what it doesn't (e.g. "Mic muted — grant microphone access to record audio").

**Files:** `UI/PermissionsView.swift`, `Capture/PermissionChecker.swift`. Add a new state to `RecorderState`: `.preparingPermissions`.

### 5. Menubar quick-record + global hotkey

Replace the static "Loom" label and the basic submenu with a Loom-style entry point.

**Menubar item:**

- **Idle** (signed in, ready): outline circle icon, label hidden.
- **Recording**: filled red circle + `00:42` mono digits in the status bar, blinking subtly.
- **Paused**: filled yellow circle.
- **Uploading**: progress ring around a small upload arrow.

**Click action: open `NSPopover`** (not a menu). The popover content is a SwiftUI view:

```
┌──────────────────────────────────────┐
│  Quick Record                  [⚙]   │
│  ┌────────────────────────────────┐  │
│  │       Start recording          │  │
│  │   [primary, accent-colored]    │  │
│  └────────────────────────────────┘  │
│                                      │
│  Source     Display 1          [⌄]   │
│  Camera     FaceTime HD        [⌄]   │
│  Mic        MacBook Pro Mic    [⌄]   │
│  Audio      ✓ Include system audio   │
│                                      │
│  ─────────────────────────────────   │
│  Open Dashboard         ⌘D           │
│  Open last recording    ⌘L           │
│  Sign out                            │
└──────────────────────────────────────┘
```

While recording, the popover replaces "Start recording" with three action buttons (Stop / Pause / Discard) and shows the recording HUD's state mirrored.

**Global hotkey:**

- Default: `⌥⇧L` (option-shift-L). Avoid `⇧⌘5` (Apple-reserved screenshot tool) and `⌘R` (browser reload).
- Press: toggle record (start if idle, stop if recording).
- Configurable from Settings → Hotkeys.
- Implementation: Carbon's `RegisterEventHotKey` (still standard for global hotkeys on macOS) wrapped in a small Swift class. No third-party dependency for v1.

**Settings window:** new minimal window (or System Settings-style pane in the main app):

- Hotkey re-binding.
- Default save location (currently temp; users may want to persist locally for failed-upload retry).
- Default recording resolution (screen-native vs 1080p downscale).
- Log out.
- About + version + open dashboard.

---

## Architecture changes from M1

| Area | M1 state | M2 state |
|---|---|---|
| Composite encoding | `SCRecordingOutput` (opaque) | `AVAssetWriter` + `AVAssetWriterInputPixelBufferAdaptor` + `CIContext` |
| Screen frame consumption | Recording output writes file directly | `SCStreamOutput` delivers `CMSampleBuffer` to a `CompositeRecorder` |
| Camera frame source | Live `AVCaptureVideoPreviewLayer` only (preview, not captured) | New `CameraCaptureCoordinator` with `AVCaptureVideoDataOutput` feeding both the preview and the compositor |
| Bubble in export | Absent | Composited every frame at live `BubblePlacement` |
| Recording HUD | Audio only | Audio + Video |
| Source selection | Read-only list | `SCContentSharingPicker` + remembered choice |
| Permissions | Implicit, on-error | Explicit preflight + System Settings deep-links |
| Menubar | Static label + basic submenu | State-aware icon + `NSPopover` quick-record + global hotkey |
| Recorder state | 10 enum cases, imperative transitions in 26 KB view model | Same enum, but extract a small `RecorderStateMachine` with an `apply(_ event:)` method to centralize allowed transitions (read: cleanup tax, not a new feature) |

The state-machine extraction is small and worth doing while the file's open — current `RecorderViewModel` is 674 lines and has implicit state transitions sprinkled through async closures, which makes the new pause/resume + HUD state harder to reason about. Out-of-scope to refactor it wholesale; in-scope to pull state transitions into `Models/RecorderStateMachine.swift` with tests.

---

## Acceptance criteria

- A signed-in user clicks the menubar icon → popover opens → clicks "Start recording" → 3-2-1 countdown overlay (or skipped if disabled) → recording starts.
- During recording: a floating HUD shows recording state with elapsed timer and mic meter, visible above all apps, never appearing in the captured pixels.
- The user drags the camera bubble; the dragged position appears in the exported composite MP4 frame-for-frame.
- The exported `composite.mp4` plays in QuickTime with the bubble visible at the dragged positions.
- Stop from the HUD finalizes capture, uploads via the existing `/api/recordings/*` flow, surfaces the recording on the existing dashboard.
- Picking a non-default display, window, mic, or camera in the popover changes what's captured.
- Pressing `⌥⇧L` while idle starts a recording; pressing again stops it.
- First launch shows the permissions preflight; granting then skipping surfaces inline errors for what's missing.
- All M1 features (audio note, Obsidian sync, meeting detection, bubble overlay panel) still work.
- `desktop/Tests/LoomDesktopTests/` has unit tests for `BubblePlacement` coordinate mapping (≥ 6 cases) and `RecorderStateMachine` transitions (≥ 8 cases).

---

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| `CIContext` per-frame cost on 4K + 60 Hz screens | Frame drops, CPU/GPU pressure | Pin minimum to 30 fps composite; benchmark on Ian's M4 Pro before claiming "premium" |
| `SCContentSharingPicker` lock-in to macOS 14+ | Older machines miss the picker | M1 spec already targets macOS 14; same answer |
| HUD sharing-type fragility | HUD might still appear in capture if `sharingType = .none` is unreliable | Add a self-test: take a frame from `SCStream`, look for the HUD by pixel signature; fail loudly if found |
| Bubble coord-math regressions | Bubble drifts in export vs preview | Heavy unit tests on `BubblePlacement`; visual regression test with a fixed test recording |
| Global hotkey conflicts with Loom Pro / CleanShot X | User binds `⌥⇧L`, real Loom is also installed | Hotkey configurable; default chosen for low conflict |
| `AVAssetWriter` pause/resume timestamp drift | Audio out-of-sync after resume | Standard pattern: track `pauseStartTime`, subtract from PTS on resume; tests covering pause-stop cycle |
| User clicks "Start recording" before permissions granted | Crash or silent failure | `RecorderState.preparingPermissions` blocks the start button when any required permission is missing |
| State-machine extraction touches a 674-line file | Regressions in M1 features | Extract incrementally; ship behind a feature flag in code (`useStateMachine: Bool`) for the first dev cycle |

---

## Open questions

- **Default capture resolution.** Screen-native (4K MBP) is gorgeous but uploads are huge. Recommend 1440p downscale by default with "screen-native" as a checkbox in Settings.
- **Pause/resume in v1?** Pause is in the state machine and the HUD design but the code path is non-trivial (PTS arithmetic). Recommend ship pause UI + plumbing but mark it experimental until tested across audio + video tracks. **Decision pending Ian's call.**
- **Should the menubar popover show recent recordings?** A 3-row "Recent" section would be premium. Probably defer to M3.
- **Region capture.** Loom does not have it; CleanShot X does. Defer.
- **Sound effect on start/stop.** Loom plays a subtle tick. Defer; trivial to add later.

---

## Out of scope (deferred to M3 or later)

- Region (drag-rectangle) capture.
- HEVC / ProRes options in Settings.
- Multi-display capture.
- On-screen drawing / annotation during recording.
- Signed release DMG + notarization + Sparkle (separate ops sprint).
- Multi-monitor HUD (HUD always on the primary display in M2).
- Keyboard shortcut customization per-action (only the master start/stop hotkey is configurable in v1).
- Recent recordings in the menubar popover.

---

## What success looks like

After M2 ships, recording a 30-second screen+camera+mic capture should feel indistinguishable from Loom's macOS app to a user who hasn't seen the source code:

1. They click the menubar icon (popover opens) → click "Start recording" → 3-2-1 countdown → recording starts with a live HUD on screen.
2. The bubble shows on screen exactly where they dragged it last time.
3. They drag the bubble mid-recording; the HUD shows elapsed time + their mic level pulsing.
4. They click stop in the HUD; the upload kicks off; a notification fires when ready; the dashboard shows the recording with the bubble visible in the exported MP4.

That's the bar.
