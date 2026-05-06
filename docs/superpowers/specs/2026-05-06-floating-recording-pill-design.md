# Floating Recording Pill — Granola-parity always-visible audio reminder

**Author:** Claude Opus 4.7
**Date:** 2026-05-06
**Status:** Built 2026-05-06 (`RecordingStatusOverlayController` + `RecordingStatusOverlayView` in `desktop/Sources/LoomDesktopApp/UI/RecordingStatusOverlay.swift`); pending install + dogfood. Stage-8 in-app `RecordingStatusPill.swift` retired in the same commit. The retired no-op `AudioRecordingWindowController.swift` was removed too.
**Driving feedback:** Ian, 2026-05-06 (during the same live call as the live-transcription-drawer spec) — *"Granola has this cool very small and unobtrusive vertical pill overlay with the granola logo and a simple three vertical bar sound waveform (that responds to the audio), and it follows you whatever desktop window you're on so you're always reminded that it's recording (very helpful)…"*

---

## Why this milestone

The Stage 8 `RecordingStatusPill` solves the "did I forget I'm recording?" problem **inside the Loomola window**. The moment the user switches to Zoom, Slack, Chrome, or hits Mission Control to a different Space, the reminder vanishes. For audio note recordings — which are the entire point of Granola-style capture — the user is *almost never* in Loomola during the recording. They're in their meeting app. The in-app pill never triggers because they never see the home view.

Granola fixes this with a small floating vertical pill that lives on **every** Space and every desktop, on top of every app. It's small enough to be unobtrusive, big enough to read at a glance, and always reachable. Tap it → jump to the note. Drag it (via a hover-revealed grip) → move it anywhere on screen.

This is the second of the two killer in-meeting moments Granola does that we don't (live transcription drawer is the other — see `2026-05-06-live-transcription-drawer-design.md`).

---

## Goals

- A small (~36pt wide × ~88pt tall) vertical capsule overlay appears as soon as an audio note recording starts and stays visible across **every** Space and **every** application until recording ends.
- The pill shows: Loomola brand mark (top), 3-bar live audio meter (bottom). Mirrors Granola's silhouette.
- On hover, a 6-dot grid drag handle appears at the top edge of the pill — drag from the handle to reposition the pill anywhere on screen.
- Click on the non-drag area while hovered → background tints (hover state, like a button) and the click brings Loomola to the front + opens the workspace bound to the active recording (sets `MainRecorderView.noteTarget = .recording`).
- Position persists in `UserDefaults` so it returns to the same spot on the next recording (Granola behavior).
- Pill **never appears in the user's own screen captures** — `sharingType: .none` on the panel, just like the bubble overlay.
- Pill never overlaps the macOS menu bar or the Dock — clamps to the visible screen frame on each move.
- The Stage-8 in-app `RecordingStatusPill` becomes redundant once this ships and is removed; the floating pill is the single audio-recording reminder surface.

## Non-goals (v1)

- **Video recording HUD does not change.** Video already has a top-center `VideoRecordingWindowController` HUD pill plus the bubble overlay; the user is by-definition aware (they're recording their screen). v1 of this spec is audio-only.
- **System-wide click-through "Open note" hotkey.** Standard global ⌥⇧N or similar. Nice-to-have, defer to v2.
- **Multi-monitor edge cases beyond clamping.** v1 just keeps the pill on whatever screen its frame's center lives on after a drag; no logic for "always on the screen with the active app."
- **Pill drag inertia / snap zones.** The pill follows the mouse during drag and lands wherever it's released. No "snap to right edge" magnet behavior in v1.

---

## Architecture

### High level

The implementation pattern is identical to the existing `BubbleOverlayWindowController` (camera bubble for video recordings) — a borderless `NSPanel` with cross-spaces collection behavior, hosted SwiftUI content, and a controller that brokers visibility based on view-model state.

```
RecorderViewModel
  └─ activeRecordingKind: .audio | .video | nil
       │
       │ on transition to .audio
       ▼
MainRecorderView.onChange(activeRecordingKind)
  └─ RecordingStatusOverlayController.show(viewModel:, onTap:)
       │
       │ creates / shows NSPanel
       ▼
RecordingStatusOverlayController
  ├─ NSPanel (level: .floating, canJoinAllSpaces, stationary, sharingType: .none)
  ├─ NSHostingView<RecordingStatusOverlayView>
  └─ tracks viewModel.audioLevel via Combine for live meter
```

### New components (desktop)

**`RecordingStatusOverlayController.swift`** — `@MainActor` AppKit controller, lifetime owned by `MainRecorderView` (one-per-app singleton via `@State`). Methods:

```swift
func show(viewModel: RecorderViewModel, onTap: @escaping () -> Void)
func hide()
var isVisible: Bool { get }
```

NSPanel configuration:
- `styleMask: [.borderless, .nonactivatingPanel]` so clicking it doesn't pull our app focus
- `level: .floating`
- `collectionBehavior: [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary]` — appears on every Space, doesn't move when user switches Spaces, follows into fullscreen apps. Identical to what `NotesSidePanelWindowController` used (Stage 6) before that side-panel was retired in Stage 8.
- `sharingType: .none` so the pill doesn't appear in user's own screen recordings (same fix used by the bubble overlay)
- `hidesOnDeactivate: false`, `isMovableByWindowBackground: false` (we'll handle drag via gesture so it only fires from the grip)
- `backgroundColor: .clear`, `isOpaque: false`, `hasShadow: true`

Position recall:
- On show: read `UserDefaults.standard.dictionary(forKey: "loomola.recordingPill.position")` for `x: CGFloat, y: CGFloat`. Default: top-right of the visible screen frame, ~16pt from top + right edge (matches Granola screenshot).
- On drag end: clamp to `NSScreen.main.visibleFrame`, write back to UserDefaults.

**`RecordingStatusOverlayView.swift`** — SwiftUI hosted view. Layout:

```swift
struct RecordingStatusOverlayView: View {
    @ObservedObject var viewModel: RecorderViewModel
    let onTap: () -> Void
    let onDragChanged: (CGSize) -> Void
    let onDragEnded: () -> Void

    @State private var hovering = false
    @State private var clicking = false

    var body: some View {
        VStack(spacing: 0) {
            // Drag grip — visible only on hover, ~16pt tall
            if hovering {
                DragGripIcon()           // 6-dot grid, SF Symbol "grip.lines"
                    .frame(height: 16)
                    .gesture(
                        DragGesture(coordinateSpace: .global)
                            .onChanged { onDragChanged($0.translation) }
                            .onEnded { _ in onDragEnded() }
                    )
            }

            // Brand mark — Loomola logo (the bundled `loomola-logo-mark`
            // already exists; reuse `BrandLogoMark(size: 22)`)
            BrandLogoMark(size: 22)
                .padding(.top, hovering ? 4 : 12)

            // 3-bar live audio meter
            ThreeBarMeter(level: viewModel.audioLevel)
                .padding(.vertical, 10)
        }
        .frame(width: 36)
        .padding(.horizontal, 6)
        .background(
            Capsule()
                .fill(.regularMaterial)
        )
        .overlay {
            Capsule()
                .strokeBorder(
                    clicking ? DSColor.Accent.primary.opacity(0.6) :
                    hovering ? Color.white.opacity(0.18) :
                                Color.white.opacity(0.10),
                    lineWidth: 1
                )
        }
        .scaleEffect(clicking ? 0.97 : 1.0)
        .contentShape(Capsule())
        .onHover { hovering = $0 }
        .onTapGesture { onTap() }
        .pressEvents(
            onPress: { clicking = true },
            onRelease: { clicking = false }
        )
        .animation(LoomolaMotion.quick, value: hovering)
        .animation(LoomolaMotion.quick, value: clicking)
    }
}
```

**`ThreeBarMeter`** — 3 vertical bars, sqrt-curve perceived loudness (matches the existing 5-bar meter pattern in `RecordingStatusPill` and the workspace's recording control bar). Each bar 3pt wide, 2pt corner radius, accent green at ~85% opacity. Spring animation on level change.

**`DragGripIcon`** — 6-dot grid icon. SF Symbol `grip.lines.vertical` if available, otherwise hand-drawn 2×3 dot grid in 12×12pt. Tertiary text color, lighter opacity.

### Drag implementation

`onDragChanged` updates the panel frame via `panel.setFrameOrigin(NSPoint(x: startX + dx, y: startY - dy))` (note: macOS y-coordinates are bottom-up, so SwiftUI's downward dy maps to subtraction).

`onDragEnded` writes the new origin to `UserDefaults`. No live persistence — only on release.

Clamp to `NSScreen.main?.visibleFrame ?? .zero` before applying so the pill can't be dragged off-screen or behind the menu bar / Dock.

### Tap → open workspace

`onTap` callback fires `MainActor` work:
1. `NSApp.activate(ignoringOtherApps: true)` — pull Loomola to front
2. `AppActivation.bringRecorderToFront()` (existing helper) — un-minimize, bring main window to front
3. Set `MainRecorderView.noteTarget = .recording` — opens the workspace bound to the active recording

Since this happens through MainRecorderView, we pass the closure in at `show(...)` time:

```swift
recordingStatusOverlay.show(viewModel: viewModel) {
    AppActivation.bringRecorderToFront()
    noteTarget = .recording
}
```

### Lifecycle wiring

In `MainRecorderView`:
```swift
@State private var recordingStatusOverlay = RecordingStatusOverlayController()

.onChange(of: viewModel.activeRecordingKind) { _, kind in
    // ...existing handlers
    updateRecordingStatusOverlay()
}

private func updateRecordingStatusOverlay() {
    if viewModel.activeRecordingKind == .audio {
        recordingStatusOverlay.show(viewModel: viewModel) {
            AppActivation.bringRecorderToFront()
            noteTarget = .recording
        }
    } else {
        recordingStatusOverlay.hide()
    }
}

.onDisappear {
    // ...existing teardown
    recordingStatusOverlay.hide()
}
```

The overlay's audio meter reads `viewModel.audioLevel` directly via `@ObservedObject`, so no manual update plumbing is needed (unlike the existing `VideoRecordingWindowController` which has a separate `updateLevel` method — that pattern is fine but @ObservedObject is cleaner here since SwiftUI already lives in the panel).

---

## What gets retired

- The Stage 8 `RecordingStatusPill` (in-app bottom-anchored pill on home view when audio recording is active and `noteTarget == nil`) becomes redundant. Once the floating pill ships, we delete `RecordingStatusPill.swift` and remove the overlay from `MainRecorderView`. The floating pill IS the single reminder.

---

## UX details (Granola-shape)

From the user's screenshot of Granola during a live call:

**Resting state (no hover):**
- Vertical capsule, ~36pt × ~88pt
- Translucent material background (NSVisualEffectView via `.regularMaterial`)
- Loomola logo mark centered top, ~22pt diameter
- 3 vertical bars below, equal spacing, spring-animated to audio level
- Hairline border (~10% white opacity)
- Drop shadow, subtle

**Hover state:**
- Drag grip (⋮⋮ icon, 6-dot pattern) appears at the top, pushing the logo down
- Background tints subtly lighter
- Border opacity bumps to ~18%
- Cursor changes: pointing finger over body (clickable), grab over the grip
- Smooth `LoomolaMotion.quick` transition

**Active (mouse-down) state:**
- Capsule scales to 0.97
- Border becomes accent (the Loomola blue) at 60% opacity
- Releases back to hover state on mouse-up; tap fires

**Drag state:**
- Cursor: closed-hand
- Pill follows cursor with no inertia
- On release: snaps to clamped position, persists to UserDefaults

---

## Schema additions

None. This is pure desktop UI — no API or database changes.

---

## Implementation phases

**Phase 1 — Panel + view (~half day)**
- `RecordingStatusOverlayController` with show/hide
- `RecordingStatusOverlayView` SwiftUI implementation
- `ThreeBarMeter` + `DragGripIcon` helper views
- Position recall via UserDefaults (`loomola.recordingPill.position`)
- Wire to `MainRecorderView` on `activeRecordingKind == .audio`

**Phase 2 — Drag (~couple hours)**
- `DragGesture` on the grip-only zone
- Frame translation + screen clamping
- Persistence on release

**Phase 3 — Tap (~couple hours)**
- Tap gesture on the non-drag region
- Bring app to front + set workspace target
- Press-down/release visual feedback

**Phase 4 — Polish (~couple hours)**
- Hover transitions tuned
- Cursor changes (pointing finger / grab / closed-hand) via `NSCursor` push/pop
- Drop shadow tuning
- Verify `sharingType: .none` actually excludes the pill from screen captures (smoke test with QuickTime screen recording)

**Phase 5 — Cleanup (~couple hours)**
- Delete `RecordingStatusPill.swift` + its render block in `MainRecorderView`
- Update CLAUDE.md / ROADMAP.md to mark Stage-8 in-app pill as superseded

Total v1 estimate: ~1 working day. Smaller than the live-transcription drawer; this is a contained UI add with no backend involvement.

---

## Open questions

1. **Hover-to-reveal grip vs always-visible grip?** Granola hides the grip until hover. Cleaner. v1 follows Granola; if discoverability becomes an issue, we can add a one-time tooltip on the first recording.
2. **What happens if the user drags the pill onto a fullscreen Zoom call?** `.fullScreenAuxiliary` collection behavior should keep it visible. Smoke-test required.
3. **Should the pill auto-fade if untouched for >30s?** Granola does **not** fade — it's a recording reminder, fading defeats the purpose. v1 stays opaque.
4. **What about a "discard" affordance on the pill?** Granola has none — discard is a deliberate action, not a casual click. Keeping the floating pill simple matches that.

---

## What this unlocks

- Closes the second of two big in-meeting Granola moments (live transcription is the other).
- Makes audio note recording feel as ambient as Granola's — start it once and forget it's running until you click back to the note.
- Removes the redundancy of the Stage-8 in-app pill, simplifying the home view chrome.
- Sets up the pattern for a future video-recording floating reminder if we want one (currently video has top-center HUD that doesn't follow across desktops).

---

## Spec status

Spec only. Not planned, not assigned. Filed in the ROADMAP under "Open follow-ups" so it surfaces during the next sprint planning pass. Pairs naturally with the live transcription drawer spec — both are Granola in-meeting moments and could ship in the same milestone.
