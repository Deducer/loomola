# Desktop App M3 — Visual Restructure — Implementation Plan

**Date:** 2026-05-04
**Spec:** [`docs/superpowers/specs/2026-05-04-desktop-app-m3-visual-restructure-design.md`](../specs/2026-05-04-desktop-app-m3-visual-restructure-design.md)
**Status:** Ready to execute
**Style:** Tokens + controls first (zero behavior change), then layout swap one home view at a time, then recording state, then settings sheet, then signed-out + permissions hero, then polish + restyle existing windows.

This plan turns the desktop app shell from "default SwiftUI demo" into "premium SaaS." Behavior is preserved end-to-end — the view model, capture coordinators, hotkeys, HUD, and composite recorder do not change. Every phase builds + tests cleanly. Ship is via a single `main` branch (no flag); each phase is a stand-alone commit so a regression in any phase is bisectable.

**Locked decisions** (from spec open questions):

- Brand line on signed-out: **"Capture you own."**
- Display + body font: **Inter** (variable, bundled). Mono: **JetBrains Mono** (variable, bundled).
- Recent strip count: **4** + a "View all →" link to the dashboard.
- Settings: **sheet** (single-window app stays single-window).
- Recording state: **replace** main view (Granola-style, full attention).
- In-scope: restyle existing audio recording panel + meeting prompt window with new tokens.

---

## Phase 0 — Foundations (tokens + fonts + Card)

**Goal:** introduce the design system without changing any user-visible surface yet. After Phase 0, every existing view still renders identically; the new tokens are *available* for later phases to consume.

### 0.1 — Bundle fonts + register at launch

- **New files:**
  - `desktop/Resources/Fonts/Inter-VariableFont_slnt,wght.ttf` (download from rsms.me/inter, OFL)
  - `desktop/Resources/Fonts/JetBrainsMono-VariableFont_wght.ttf` (download from jetbrains.com/lp/mono, OFL)
- **Edit:** `desktop/Package.swift` — add a `.process("Resources/Fonts")` rule (or `.copy` if process doesn't include `.ttf` in the SwiftPM bundling whitelist; verify in build).
- **Edit:** `desktop/Sources/LoomDesktopApp/App/LoomDesktopApp.swift` — register fonts at `init()` via `CTFontManagerRegisterFontsForURL`. Log success/failure.
- **Acceptance:** `print("Loomola fonts registered: Inter, JetBrains Mono")` appears in console at launch. `NSFont(name: "Inter", size: 14)` returns non-nil in unit test (or sanity check via a tiny SwiftUI preview).
- **No behavior change** — nothing actually uses the fonts yet.

### 0.2 — Color tokens

- **New file:** `desktop/Sources/LoomDesktopApp/UI/DesignSystem/Tokens/DSColor.swift`
- Exposes a `DSColor` enum / namespace with static properties: `bg.canvas`, `bg.surface`, `bg.surfaceRaised`, `bg.subtle`, `text.primary`, `text.secondary`, `text.tertiary`, `border.subtle`, `border.strong`, `accent.primary`, `accent.muted`, `state.recording`, `state.success`, `state.warning`. Each is a SwiftUI `Color` constructed with explicit light + dark variants from the spec table.
- Pattern (Swift):
  ```swift
  enum DSColor {
      enum Bg { static let canvas = Color(light: .init(red: 0.98, green: 0.98, blue: 0.97), dark: .init(red: 0.055, green: 0.06, blue: 0.07)) }
      enum Text { static let primary = Color(light: .init(red: 0.082, green: 0.086, blue: 0.102), dark: .init(red: 0.957, green: 0.957, blue: 0.945)) }
      // ...
  }
  extension Color { init(light: Color, dark: Color) { self = Color(NSColor(name: nil) { $0.bestMatch(from: [.darkAqua, .darkAquaLowContrast]) != nil ? NSColor(dark) : NSColor(light) }) } }
  ```
- **Tests:** `desktop/Tests/LoomDesktopTests/DesignSystem/DSColorTests.swift` — verify each token resolves to a non-nil `Color` and that light + dark differ. (5 quick tests.)
- **Acceptance:** all tokens defined; tests green.

### 0.3 — Spacing, radius, shadow tokens

- **New files:**
  - `desktop/Sources/LoomDesktopApp/UI/DesignSystem/Tokens/DSSpacing.swift` — enum with static `xs=4, sm=8, md=12, lg=16, xl=24, xxl=32, xxxl=48`.
  - `desktop/Sources/LoomDesktopApp/UI/DesignSystem/Tokens/DSRadius.swift` — enum with `sm=6, md=10, lg=14, xl=20, pill=9999` (all `CGFloat`).
  - `desktop/Sources/LoomDesktopApp/UI/DesignSystem/Tokens/DSShadow.swift` — three named `View` modifiers: `.dsShadow(.subtle)`, `.dsShadow(.raised)`, `.dsShadow(.brand(color:))`.
- **Tests:** none needed beyond compile.
- **Acceptance:** tokens compile; available app-wide.

### 0.4 — Typography tokens

- **New file:** `desktop/Sources/LoomDesktopApp/UI/DesignSystem/Tokens/DSFont.swift`
- Exposes `DSFont.display.xl()`, `display.lg()`, `body.lg()`, `body.md()`, `body.sm()`, `mono.timer()`, `mono.body()`. Each returns a SwiftUI `Font` built from `Font.custom("Inter", size: ...)` (or `Font.custom("JetBrains Mono", ...)`) with the right weight + tracking + line height.
- Provide a fallback path: if the custom font fails to register at launch, the helpers fall back to `Font.system(...)` with matching size/weight (so the app degrades gracefully).
- **Tests:** smoke test that each token returns a `Font` (compile-only really).
- **Acceptance:** typography tokens available; if Phase 0.1 succeeded, they emit Inter/JetBrains; otherwise they emit system fonts.

### 0.5 — Motion namespace

- **New file:** `desktop/Sources/LoomDesktopApp/UI/DesignSystem/Tokens/LoomolaMotion.swift`
- Exposes `LoomolaMotion.quick / .medium / .expressive` as `Animation` values (with `accessibilityReduceMotion` collapse-to-nil helper).
- **Tests:** none.

### 0.6 — Card primitive update

- **Edit:** `desktop/Sources/LoomDesktopApp/UI/Card.swift` (existing primitive used by current cards) — re-implement to use new tokens (`DSColor.Bg.surface`, `DSRadius.lg`, `DSSpacing.xl` padding, `.dsShadow(.subtle)`).
- **Acceptance:** existing views that wrap content in `Card { ... }` (CaptureCard, IntegrationsCard, MeetingPromptView, StatusCard, DiagnosticsCard) immediately pick up the new look. This is the *first user-visible change* — the cards now have the new background, radius, shadow, padding. Buttons + text inside still look like before; that's intentional, controls come in Phase 1.

**Phase 0 commit:** "feat(desktop): M3 Phase 0 — design system tokens + bundled Inter/JetBrains Mono"

---

## Phase 1 — Custom controls

**Goal:** replace every default SwiftUI control style used in the app shell with new branded ones. Behavior unchanged — `PrimaryButton(action: foo) { Text("Bar") }` does exactly what `Button("Bar", action: foo).buttonStyle(.borderedProminent)` did, but looks branded.

### 1.1 — `PrimaryButton`, `SecondaryButton`, `IconButton`

- **New files:**
  - `desktop/Sources/LoomDesktopApp/UI/DesignSystem/Controls/PrimaryButton.swift`
  - `desktop/Sources/LoomDesktopApp/UI/DesignSystem/Controls/SecondaryButton.swift`
  - `desktop/Sources/LoomDesktopApp/UI/DesignSystem/Controls/IconButton.swift`
- Each wraps a SwiftUI `Button` with a custom `ButtonStyle` (`PrimaryButtonStyle: ButtonStyle { ... }`) that handles default / hover / pressed / disabled.
- **PrimaryButton:** `bg = accent.primary`, white text `body.lg medium`, `radius.pill`, `padding xl/md`, `shadow.brand` on hover, lifts 1pt on press. Disabled: `bg.subtle` + `text.tertiary`.
- **SecondaryButton:** `bg = bg.surface`, `border.strong` 1px, `text.primary`, otherwise same shape.
- **IconButton:** circular 32×32 (configurable), `bg = bg.subtle`, hover `bg = accent.muted`, takes a single `Image`.
- **Tests:** smoke test each renders with a `Text("Hi")` content.
- **Acceptance:** buttons render correctly in light + dark via SwiftUI previews (manual visual check).

### 1.2 — `SegmentedControl`

- **New file:** `desktop/Sources/LoomDesktopApp/UI/DesignSystem/Controls/SegmentedControl.swift`
- Replaces the ad-hoc `CaptureModeSelector` rendering in `MainRecorderView.swift`. Generic over a `Hashable & CaseIterable` enum bound via `@Binding`. Pill container, sliding thumb behind the selected segment animated with `LoomolaMotion.medium`.
- **Tests:** none beyond a snapshot smoke.
- **Acceptance:** drop-in callsite works.

### 1.3 — `Field` and `FieldPicker`

- **New files:**
  - `desktop/Sources/LoomDesktopApp/UI/DesignSystem/Controls/Field.swift`
  - `desktop/Sources/LoomDesktopApp/UI/DesignSystem/Controls/FieldPicker.swift`
- **Field:** SwiftUI text input wrapped with `bg.subtle`, `border.subtle` 1px, focused border `accent.primary`. Takes a placeholder + binding + optional leading icon. Used for email/password on signed-out and any future text inputs.
- **FieldPicker:** wraps `NSPopUpButton` via `NSViewRepresentable` (battle-tested AppKit primitive). Same visual style as `Field`. Generic over an `Identifiable` collection. Used for camera + mic dropdowns on the hero card and in settings.
- **Tests:** Field has a small SwiftUI preview-driven smoke. FieldPicker has a unit test that selecting an item via the binding closure fires the callback.
- **Acceptance:** both compile + render.

### 1.4 — `Pill` and `StatusDot`

- **New files:**
  - `desktop/Sources/LoomDesktopApp/UI/DesignSystem/Controls/Pill.swift` — small status badge with a kind enum (`.success / .warning / .recording / .muted / .accent`) controlling color.
  - `desktop/Sources/LoomDesktopApp/UI/DesignSystem/Controls/StatusDot.swift` — 8px colored dot + `body.sm` label.
- **Tests:** none beyond compile.
- **Acceptance:** both compile.

**Phase 1 commit:** "feat(desktop): M3 Phase 1 — custom branded controls (Primary/Secondary/Icon Button, SegmentedControl, Field, FieldPicker, Pill, StatusDot)"

---

## Phase 2 — Custom title bar + settings sheet

**Goal:** swap the system title bar for a custom one with the wordmark + gear + account avatar. Open the gear opens a still-empty settings sheet; that sheet gets populated in Phase 4.

### 2.1 — Custom title bar host

- **New file:** `desktop/Sources/LoomDesktopApp/UI/Shell/CustomTitleBar.swift`
- A 40pt-tall SwiftUI view: HStack with traffic-light spacer (78pt to clear the lights — measured at standard inset), wordmark image (centered-left, 96pt wide), spacer, settings gear `IconButton`, account `IconButton` (renders the user's first email letter in `accent.primary` text).
- **Edit:** `desktop/Sources/LoomDesktopApp/App/LoomDesktopApp.swift` (or wherever the main `WindowGroup` lives) — set `NSWindow.titlebarAppearsTransparent = true`, `titleVisibility = .hidden`. Hide the system "Loomola Desktop" title.
- **Edit:** `desktop/Sources/LoomDesktopApp/UI/MainRecorderView.swift` — top of the view becomes `CustomTitleBar` instead of `AppHeader`. Old `AppHeader` deletes (or stays unreferenced — clean up at end of phase).
- **Acceptance:** main window opens with the new title bar; traffic lights still work; window is still draggable from the title bar area (need to set `WindowAccessor` or use `WindowDragRegion` modifier — confirm during build).

### 2.2 — Empty settings sheet plumbing

- **New file:** `desktop/Sources/LoomDesktopApp/UI/Shell/SettingsSheet.swift`
- A `View` with `bg.surface`, `radius.xl`, `shadow.raised`, internal scroll, top bar with title + close `IconButton`. Body is a placeholder VStack for now ("Settings coming in Phase 4").
- **Edit:** `MainRecorderView` — add `@State private var showSettings = false`; wire the title bar's gear icon to flip it; wrap the main body in `.sheet(isPresented: $showSettings) { SettingsSheet(onDismiss: { showSettings = false }) }`.
- **Acceptance:** click gear → sheet appears. Click close or press Esc → dismiss.

### 2.3 — Empty account popover plumbing

- **New file:** `desktop/Sources/LoomDesktopApp/UI/Shell/AccountMenuPopover.swift`
- A small SwiftUI view shown via `.popover(isPresented:)` from the account `IconButton`. Contains: user email at top (read from view model), divider, "Open dashboard" button, divider, "Sign out" button. Each routes to the existing view-model methods.
- **Edit:** `CustomTitleBar` — wire account icon to a `@State` popover binding.
- **Acceptance:** click account → popover appears with email + sign out.

**Phase 2 commit:** "feat(desktop): M3 Phase 2 — custom title bar + settings sheet + account popover"

---

## Phase 3 — Home view router + idle home

**Goal:** split `MainRecorderView` into a thin router that picks among `IdleHomeView` / `RecordingHomeView` / `PermissionsHomeView` / `SignedOutHomeView` based on `(state, recordingKind)`. Implement `IdleHomeView` first (the main 95% case). Recording / permissions / signed-out come in later phases.

### 3.1 — Idle home view

- **New file:** `desktop/Sources/LoomDesktopApp/UI/Home/IdleHomeView.swift`
- Composition (top to bottom):
  - `Text("Capture")` styled with `DSFont.display.xl()`, `DSColor.Text.primary`, `padding(.top, DSSpacing.xxl)`.
  - Hero card (`Card { HeroCaptureSection(viewModel: viewModel) }`) — see 3.2.
  - `MeetingPromptView` if `viewModel.meetingPromptContext != nil` — restyled inline (not via the existing window) for the desktop M3 surface. (The existing window stays for menubar / background-app surfacing.)
  - "Recent" section with `RecentStrip` — see 3.3.
- **Acceptance:** the view compiles + renders with placeholder children. Wire-up of children happens in 3.2 / 3.3.

### 3.2 — Hero capture section

- **New file:** `desktop/Sources/LoomDesktopApp/UI/Home/HeroCaptureSection.swift`
- Composition:
  - HStack with `PrimaryButton("Start recording", icon: video.fill) { viewModel.startLocalRecording() }` + `SecondaryButton("Audio note", icon: waveform.circle.fill) { viewModel.startAudioNoteRecording() }`.
  - Below: HStack with `FieldPicker(label: "Microphone", selection: $viewModel.selectedMicDeviceID, ...)` + `FieldPicker(label: "Camera", selection: $viewModel.selectedCameraDeviceID, ...)`.
  - When `viewModel.activeRecordingKind == .audio`, the audio note flow renders an inline title field + start/stop instead of just "Audio note" — preserves the existing UX. (Or simpler: route the audio note start through the existing audio panel and keep the hero button as just the trigger. Pick the simpler one during build.)
- **Acceptance:** the two CTAs work. Pickers reflect / update UserDefaults.

### 3.3 — Recent strip

- **New files:**
  - `desktop/Sources/LoomDesktopApp/UI/Recent/RecentStrip.swift` — HStack of 4 `RecentCard`s.
  - `desktop/Sources/LoomDesktopApp/UI/Recent/RecentCard.swift` — 140×140 card with thumbnail, title (1 line truncated), relative timestamp.
  - `desktop/Sources/LoomDesktopApp/UI/Recent/RecentRecordingsService.swift` — `@MainActor ObservableObject`. Hits `GET /api/recordings?limit=6` (we ask for 6 to stay forward-compatible with a possible "View all" preview but render 4). Auto-refresh on `NSApplication.didBecomeActiveNotification`, on `viewModel.state` flipping to `.complete(slug:)`, and on a 60-second tick while the window is visible. Public types: `RecentRecording { id, slug, title, thumbnailURL?, createdAt, durationSeconds?, kind }`.
- **Web-side dependency:** the existing recordings list endpoint may not include thumbnail URLs in the list response. Check `src/lib/api/recordings/list.ts` (or wherever the route is) and add a `thumbnailUrl: string | null` to each item if missing — small change, ~5 LOC. If it's a big lift, ship Phase 3.3 with title-only cards and add thumbnails as a follow-up commit.
- **Empty state:** when `service.items.isEmpty && !service.isLoading`, render a small empty state inside the strip ("Nothing recorded yet. Hit Start recording or press ⌥⇧R."). Defined inline in `RecentStrip`.
- **Loading state:** 4 skeleton cards (`bg.subtle` rectangles with shimmer or just static fill) while loading.
- **"View all →" link:** small text link below the strip, opens `https://loom.dissonance.cloud` in default browser via `NSWorkspace.shared.open`.
- **Tests:** `RecentRecordingsServiceTests` — mock `BackendClient`, assert `refresh()` populates items, assert auto-refresh on the three triggers (use `NotificationCenter.default.post` to simulate the activate notification).
- **Acceptance:** strip renders 4 cards with real data on signed-in launch.

### 3.4 — Router refactor

- **Edit:** `desktop/Sources/LoomDesktopApp/UI/MainRecorderView.swift` — replace the body with a router:
  ```swift
  var body: some View {
      VStack(spacing: 0) {
          CustomTitleBar(...)
          Divider().overlay(DSColor.Border.subtle)
          contentForCurrentState()
      }
      .background(DSColor.Bg.canvas)
      ...
  }

  @ViewBuilder
  private func contentForCurrentState() -> some View {
      switch viewModel.state {
      case .signedOut: SignedOutHomeView(...)        // Phase 5
      default:
          if !dismissedPreflight && permissionStatus.requiredMissing {
              PermissionsHomeView(...)               // Phase 5
          } else if viewModel.activeRecordingKind != nil {
              RecordingHomeView(...)                 // Phase 4
          } else {
              IdleHomeView(...)
          }
      }
  }
  ```
- All the existing `.onChange / .onReceive / .onAppear` lifecycle hooks stay on `MainRecorderView`. The `@State` for `meetingPromptWindow` / `audioRecordingWindow` / `videoRecordingWindow` stays here too. Helpers (`updateVideoRecordingWindow`, etc.) stay.
- The big inline `signedInBody` computed view goes away — its content is now in `IdleHomeView` / `RecordingHomeView` / `PermissionsHomeView`.
- Old `CaptureCard / SourcePickerCard / IntegrationsCard / CaptureSourcesView / StatusCard / DeveloperToolsDisclosure / FooterBar / AppHeader` private structs in `MainRecorderView.swift` either get migrated into `SettingsSheet` (Phase 4) or deleted at end of M3.
- **Acceptance:** the app launches into a beautiful `IdleHomeView`. Recording start still works (it just transitions to a placeholder for now since `RecordingHomeView` lands in Phase 4). All M2 functionality intact.

**Phase 3 commit:** "feat(desktop): M3 Phase 3 — IdleHomeView + Recent strip + router split"

---

## Phase 4 — Recording home + populated settings sheet

**Goal:** finish the in-app "during recording" surface and move all the settings/integrations/permissions/diagnostics out of the main view into the settings sheet.

### 4.1 — Recording home view

- **New file:** `desktop/Sources/LoomDesktopApp/UI/Home/RecordingHomeView.swift`
- Composition:
  - Centered VStack with:
    - HStack: pulsing red `Circle` 12pt + `Text("Recording")` styled `DSFont.display.lg()` + `DSColor.Text.primary` (or `Text("Recording • <audio note title>")` when audio).
    - Mono timer (`DSFont.mono.timer()`) showing elapsed.
    - Live waveform (`AudioLevelWaveform` — wrap a small CA `CAReplicatorLayer` or use a SwiftUI Canvas with `viewModel.audioLevel`).
    - HStack with `PrimaryButton("Stop", icon: stop.fill, kind: .destructive) { viewModel.stop() }` + `SecondaryButton("Discard", icon: trash) { viewModel.cancel() }`.
  - For audio note: also a "Open note" `SecondaryButton` that routes to the existing `viewModel.openActiveAudioNote()`.
- The recording HUD (existing, top-center floating window) keeps showing — this is the *main window* representation for when the user happens to bring the main window to front during recording. Both surfaces share state.
- Routing logic in `RecorderViewModel`:
  - `.video` → calls `stopLocalRecordingAndUpload()` / `cancelLocalRecording()`.
  - `.audio` → calls `stopAudioNoteRecordingAndUpload()` / `cancelAudioNoteRecording()`.
- **Acceptance:** during a video recording, the main window swaps to this surface; pressing Stop finalizes + uploads; main view returns to idle with the new recording at head of Recent.

### 4.2 — Populate settings sheet

- **Edit:** `desktop/Sources/LoomDesktopApp/UI/Shell/SettingsSheet.swift` — fill the placeholder body with sections per the spec:
  - **Sources** — camera + mic FieldPickers + a SecondaryButton "Refresh sources".
  - **Permissions** — only renders if `permissionStatus.requiredMissing || any denied`. Otherwise hidden. Each row uses the new `Pill` for status. Reuses logic from existing `PermissionsView`.
  - **Integrations** — Chrome bridge install + Open extension folder + Sync Now. Migrated from existing `IntegrationsCard`.
  - **Diagnostics** — collapsible `DisclosureGroup`. Test video backend / Test audio backend buttons + `CaptureSourcesView` content. Migrated from existing `DiagnosticsCard` + `CaptureSourcesView`.
- Each section uses an inline `SectionHeader` view (display.lg headline + `border.subtle` underline at `padding(.bottom, sm)`).
- **Acceptance:** every action that was in the old footer / cards is reachable from settings.

### 4.3 — Restyle existing windows

- **Edit:** `desktop/Sources/LoomDesktopApp/UI/AudioRecordingWindowController.swift` — restyle the inner SwiftUI panel to use new tokens (`bg.surface` / `radius.lg` / `shadow.raised` / Inter typography). Keep behavior identical.
- **Edit:** `desktop/Sources/LoomDesktopApp/UI/VideoRecordingWindowController.swift` — same, restyle to new tokens.
- **Edit:** `desktop/Sources/LoomDesktopApp/UI/MeetingPromptWindowController.swift` — same.
- **Acceptance:** all three external panels read as the same product as the main shell.

**Phase 4 commit:** "feat(desktop): M3 Phase 4 — RecordingHomeView + populated settings sheet + restyled windows"

---

## Phase 5 — Signed-out + permissions home + empty state

**Goal:** the two remaining edge-state surfaces.

### 5.1 — Signed-out home view

- **New file:** `desktop/Sources/LoomDesktopApp/UI/Home/SignedOutHomeView.swift`
- Composition (centered):
  - 64pt Loomola glyph (existing `BrandLogoMark(size: 64)`).
  - Headline `Text("Capture you own.")` `DSFont.display.xl()`.
  - Subhead two-line description `DSFont.body.md()` + `DSColor.Text.secondary`.
  - `Field` for email + `Field` for password (both with leading icon).
  - `PrimaryButton("Sign in", icon: arrow.right) { viewModel.signIn() }` full width.
  - "Trouble signing in?" link to `https://loom.dissonance.cloud` (dashboard handles password reset).
- **Replaces:** existing `SignedOutView` private struct in `MainRecorderView.swift`. Old struct deletes.
- **Acceptance:** signed-out page reads as a brand moment.

### 5.2 — Permissions home view

- **New file:** `desktop/Sources/LoomDesktopApp/UI/Home/PermissionsHomeView.swift`
- Same shape as the existing `PermissionsView`, but presented as a *hero state* instead of a banner:
  - Hero card occupies the same slot as `HeroCaptureSection`.
  - Header: "Set up permissions" headline + one-line description.
  - Per-permission rows with `Pill` status + per-row Request / Open Settings buttons (now `PrimaryButton` / `SecondaryButton`).
  - Footer link "Skip for now" sets `dismissedPreflight = true` for the session.
- **Auto-progression:** when all required perms become `.granted`, the view auto-transitions to `IdleHomeView` (same logic as today, just animated with `LoomolaMotion.medium`).
- **Acceptance:** first-launch flow walks through perms; granting all reveals the idle hero.

### 5.3 — Empty Recent state polish

- **Edit:** `RecentStrip.swift` — add a polished empty state for first-time signed-in users with no recordings: a small SF Symbol illustration (`waveform.path.ecg.rectangle` or similar at 64pt, muted), tagline below.
- **Acceptance:** first-launch (signed in, no recordings) shows the empty state instead of skeleton cards.

**Phase 5 commit:** "feat(desktop): M3 Phase 5 — SignedOutHomeView + PermissionsHomeView + Recent empty state"

---

## Phase 6 — Cleanup + docs

**Goal:** delete dead code, update docs, prove the visual-regression catch-all.

### 6.1 — Delete dead code

- Delete the now-unused private structs in `MainRecorderView.swift`: `CaptureCard`, `CaptureModeSelector`, `CaptureModeSegment`, `SourcePickerCard`, `IntegrationsCard`, `IntegrationBlock`, `CaptureSourcesView`, `StatusCard`, `DeveloperToolsDisclosure`, `DiagnosticsCard`, `MeetingPromptView` (replaced by inline version in `IdleHomeView`), `FooterBar`, `AppHeader`, `SignedOutView`.
- Delete the old `PermissionsView.swift` if Phase 5.2 fully supersedes it. (Or keep the lower-level `PermissionsView` as a shared component used by `PermissionsHomeView` — preferred. Just ensure nothing in the app shell uses the old banner-style entry point.)
- `desktop/Sources/LoomDesktopApp/UI/MainRecorderView.swift` should drop from ~870 lines to ~150.

### 6.2 — Visual regression catch-all

- Grep across the desktop sources to confirm:
  ```
  grep -rn "borderedProminent\|.bordered$\|windowBackgroundColor\|controlBackgroundColor" desktop/Sources/
  ```
  Expect zero hits (or only in deeply justified one-off places, documented inline).
- Grep for hardcoded colors like `Color.red`, `Color(red:` outside `DSColor`:
  ```
  grep -rn "Color(red:\|Color\.red\b\|Color\.blue\b" desktop/Sources/LoomDesktopApp/UI/ | grep -v DesignSystem
  ```
  Expect zero hits in non-DesignSystem files.
- Grep for hardcoded font names:
  ```
  grep -rn "Font.system\|Font.custom" desktop/Sources/LoomDesktopApp/UI/ | grep -v DesignSystem
  ```
  Expect zero hits in non-DesignSystem files.

### 6.3 — Update CLAUDE.md / AGENTS.md / ROADMAP.md

- **CLAUDE.md / AGENTS.md:** add a new "Stage 5 — Desktop M3" section between Stage 4 and "Recent web work." Summarize the design system, the home view structure, and the per-state router pattern. Note the new files in the file tree.
- **ROADMAP.md:** add Stage 5 row marked ✅ shipped 2026-05-04 with the same per-phase breakdown as M2 had.
- Note the bundled Inter + JetBrains Mono fonts under "Stack" in CLAUDE.md.

### 6.4 — Tests + smoke

- All existing 56 desktop swift tests still pass.
- New tests added in Phases 0.2 + 1 + 3.3 add ~10–15 tests. Total ~70.
- Manual smoke (will be done by Ian on next dogfood):
  - Sign out → sign in works.
  - Idle home shows Recent strip with real data.
  - Click Start recording → records → stop → upload → main returns to idle, new card at head of Recent.
  - Audio note start → record → stop → upload.
  - Open settings gear → change camera → close sheet → camera changed.
  - Click account avatar → sign out.
  - Toggle bubble overlay (⌥⇧B) → still works.
  - Press ⌥⇧R → start/stop recording from anywhere.
  - Force-quit and relaunch → window remembers nothing yet (`NSWindow.setFrameAutosaveName` is out of scope).

### 6.5 — Final commit

**Phase 6 commit:** "feat(desktop): M3 Phase 6 — cleanup + visual-regression catch-all + docs"

---

## Total estimated effort

| Phase | Scope | Estimate |
|---|---|---|
| 0 — Foundations | Tokens, fonts, Card | 2–3h |
| 1 — Controls | 8 control primitives | 4–5h |
| 2 — Title bar + sheet | Custom title bar + empty sheet + popover | 2–3h |
| 3 — Idle home | Router + IdleHome + RecentStrip + service | 4–6h |
| 4 — Recording home + sheet content | RecordingHome + populated settings + restyle 3 windows | 4–6h |
| 5 — Edge states | SignedOut + PermissionsHome + empty Recent | 3–4h |
| 6 — Cleanup + docs | Delete dead code + grep audit + docs | 1–2h |
| **Total** | | **20–29h (~3–4 dev days)** |

---

## What we're not doing in M3

(Already in the spec, restated here so the plan stays narrow.)

- New recording features.
- Window state persistence (`setFrameAutosaveName`).
- Onboarding tour.
- Notifications.
- Sounds.
- Drag-and-drop video upload.
- Search box.
- Custom dock icon variant.
- Right-click context menus on Recent cards beyond Open / Copy link.
- VoiceOver / Dynamic Type / accessibility audit.
- Localization.

---

## Build order rationale

- **Phase 0 first** because every later phase consumes tokens. Doing tokens later means redoing every component.
- **Phase 1 (controls) before Phase 2 (title bar)** because the title bar uses `IconButton`.
- **Phase 2 (title bar + empty sheet) before Phase 3 (router)** so the router can reference the title bar without a stub.
- **Phase 3 (idle home) before Phase 4 (recording + populated sheet)** because idle is the most common state to verify; everything else regressions become obvious quickly.
- **Phase 4 (recording + sheet)** moves all the now-orphaned UI into its final home.
- **Phase 5 (edge states)** is independent of Phase 4 but builds on Phase 1 + 2 controls; doing it last lets the recording state stabilize first.
- **Phase 6 (cleanup + docs)** can only happen once everything else is in place.

This order means the app is *always* shippable after each phase commit — even partway through, every M2 capability still works; the visual upgrade just isn't complete yet.
