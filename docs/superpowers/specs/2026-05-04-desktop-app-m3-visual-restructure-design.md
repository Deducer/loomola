# Desktop App M3 — Visual Restructure (Granola-grade shell)

**Author:** Claude Opus 4.7
**Date:** 2026-05-04
**Status:** Spec'd, ready to plan + build
**Predecessor spec:** [`docs/superpowers/specs/2026-05-04-desktop-app-m2-premium-recorder-design.md`](2026-05-04-desktop-app-m2-premium-recorder-design.md) (the M2 desktop app — recorder shipped feeling premium; the *shell around the recorder* did not)

---

## Why this milestone

M2 made the *recorder* feel premium: HUD, hotkeys, AEC, source picker, composite writer. But the surrounding desktop shell — what the user sees when they open the main window — still reads as a developer tool. Specifically:

- **Stock-AppKit chrome everywhere.** `MainRecorderView.swift` uses default `.borderedProminent` buttons, default Picker dropdowns, default Card backgrounds, default Divider lines. Granola has a *recognizable visual language* — soft custom shadows, branded typography, generous padding, restrained color. Loomola has a SwiftUI demo aesthetic.
- **Everything is visible at once.** Signed-in body stacks: AppHeader, optional PermissionsView, optional MeetingPromptView, CaptureCard (with mic + system toggles + tab switcher + start buttons), SourcePickerCard (camera + mic + refresh), IntegrationsCard (Chrome + Obsidian), CaptureSourcesView (raw debug list of devices), StatusCard, DeveloperToolsDisclosure (collapsed Diagnostics), then a FooterBar. That's *eight content blocks* to find the one button you came to press 95% of the time. Granola's main window is one big action area + a small recent-notes list, with everything else behind a settings gear.
- **Status copy reads like dev logs.** `"Ready to sign in. Saved sessions are not auto-restored in this dev build."` / `"Stopped screen stream after N frame(s)."` / `"Starting composite recording..."`. These are honest engineering messages, not product voice. A premium app shows progress visually (spinners, bars, transitions) and uses one-word states (`Ready`, `Recording`, `Uploading`).
- **The action you take 95% of the time is buried.** Open the app → find the CaptureCard → switch to Video tab → click Start recording. Granola opens to a screen where a giant "New meeting" button is the visual centerpiece. The path from launch to recording should be **one click**, even from the main window (the menubar / hotkey shortcuts already cover the zero-click case).
- **First-run / signed-out is barely styled.** `SignedOutView` is two text fields + a Sign In button on a system background. First impression of the product.
- **The footer is busy.** `Refresh sources`, `Open Library`, `Sign out` — three actions that should be in three different places (sources hide entirely, library is a menubar item, sign out is in account menu).
- **No motion.** Buttons jump on click. Tabs swap instantly. Status messages flicker between sentences. Granola has subtle eased transitions on every state change — that single difference is what reads as "polished" vs. "raw."

Closing these gaps takes the desktop app from "early dev build with a polished recorder" to "premium SaaS shell that happens to record." It's the natural sibling milestone to M2 and the bar a Granola/Loom user would expect on first open.

## Goals

- **One-click record from the main window** for both video and audio. The primary CTA is the visual anchor of the page; everything else gets out of its way.
- **Custom visual language** — branded color tokens, custom typography, consistent spacing rhythm, custom button + control styles — that no longer reads as default SwiftUI.
- **Progressive disclosure of secondary surfaces.** Sources, Integrations, Permissions, Diagnostics, Sign out all live behind a single settings gear (or split between settings and an account menu) instead of every card always visible.
- **Recent activity prominent.** Last 4–6 recordings/notes shown on the main view with thumbnails and titles, clickable into the web dashboard. This is what makes the app feel like a *home* instead of a *form*.
- **Motion + state polish.** State changes use brief eased transitions (~120–180ms). No instant flicker between sentences in status copy. Recording start has a satisfying micro-animation.
- **Signed-out screen is a brand moment**, not a system form.
- **Custom title bar.** The macOS default title bar reads as "system app." A custom title bar with the Loomola wordmark + a small accent strip + the traffic-light buttons inset reads as "product."
- All M2 features (composite recorder, HUD, hotkeys, source picker, permissions preflight) keep working unchanged — this is a *visual + structural* milestone, not a feature milestone.

## Non-goals (explicit fence)

- **No new recording features.** No new capture modes, no editor, no annotations, no region capture. M2's recorder is the recorder.
- **No icon redesign.** The Loomola wordmark + glyph stays. (Replacing the dock icon's color treatment to fit the new palette is in scope; designing a new mark is not.)
- **No bundled commercial font.** Free fonts only — pulled from disk via `NSFont` registration if local, otherwise a high-quality system fallback. Custom-font upload for *brand profiles* is a separate web-side feature.
- **No multi-window architecture.** One main window + one settings sheet (presented inside the main window, not a separate panel). The bubble overlay + recording HUD + meeting prompt + audio recording panel are all existing M2 windows and stay separate — they're not part of "the shell" being restructured.
- **No localization pass.** English only.
- **No accessibility pass beyond what's already there.** Reduce-motion is honored on new transitions, but a full VoiceOver / Dynamic Type pass is its own milestone.
- **No native menubar redesign.** Menubar quick-record (item with hotkey) stays as is from M2. Reworking the menubar into a popover is deferred to a later milestone.
- **No analytics / event tracking added.** This is purely visual.

---

## Visual language (the new design system)

A small, opinionated set of tokens and primitives that every new component pulls from. Codified in `desktop/Sources/LoomDesktopApp/UI/DesignSystem/` so adding a new view never tempts hardcoded colors / spacing.

### 1. Color tokens

Light mode (default for new app — system overrides existing, but we ship a deliberate palette):

| Token | Light | Dark | Used for |
|---|---|---|---|
| `bg.canvas` | `#FAFAF7` (warm off-white) | `#0E0F12` | Main window background |
| `bg.surface` | `#FFFFFF` | `#181A20` | Cards, sheets |
| `bg.surface.raised` | `#FFFFFF` w/ shadow | `#1F222A` | Hovered cards, popovers |
| `bg.subtle` | `#F2F1EC` | `#22252E` | Inset wells, secondary chips |
| `text.primary` | `#15161A` | `#F4F4F1` | Headings, body |
| `text.secondary` | `#5C5E66` | `#9DA0AC` | Captions, muted |
| `text.tertiary` | `#8A8C95` | `#6A6D78` | Placeholder, disabled |
| `border.subtle` | `#EBEAE3` | `#2A2D37` | 1px hairlines, dividers |
| `border.strong` | `#D5D3CA` | `#3B3F4C` | Card outlines (when used) |
| `accent.primary` | `#3B82F6` (loomola blue) | `#5C9BFF` | CTAs, brand moments |
| `accent.muted` | `#3B82F6` @ 12% alpha | `#5C9BFF` @ 18% alpha | Hover/selected fills |
| `state.recording` | `#E84B45` | `#E84B45` | Live recording dot, HUD |
| `state.success` | `#1FA672` | `#34D399` | Granted, uploaded |
| `state.warning` | `#D69E2E` | `#F6AD55` | Permission pending |

The current desktop app uses `Color(nsColor: .windowBackgroundColor)` and the rest of SwiftUI semantic colors. We replace those with `DS.color.bg.canvas` etc. — semantic tokens that read from a single `LoomolaPalette` struct that switches by colorScheme. The system palette gets the boot.

### 2. Typography

Free fonts, registered at app launch via `CTFontManagerRegisterFontsForURL`:

- **Display:** [Inter](https://rsms.me/inter/) (regular, medium, semibold, bold). Variable font, ~700 KB. Ships in `desktop/Resources/Fonts/Inter-Variable.ttf`.
- **Mono:** [JetBrains Mono](https://www.jetbrains.com/lp/mono/) (regular, medium). For timer + status code surfaces. ~150 KB.

Type scale (rems-equivalent in pt, anchored to a 14pt base):

| Token | Size | Weight | Tracking | Line height | Use |
|---|---|---|---|---|---|
| `display.xl` | 32pt | semibold (600) | -1.5% | 1.10 | Page headline ("Capture") |
| `display.lg` | 24pt | semibold | -1% | 1.15 | Section titles |
| `body.lg` | 16pt | medium | normal | 1.40 | CTA labels |
| `body.md` | 14pt | regular | normal | 1.45 | Default body |
| `body.sm` | 12pt | medium | +1% | 1.40 | Pills, captions |
| `mono.timer` | 18pt | medium (Mono) | normal | 1.20 | HUD timer, durations |
| `mono.body` | 12pt | regular (Mono) | normal | 1.40 | Diagnostics |

### 3. Spacing + radius

A 4pt-based rhythm (Granola is on 4pt; Loom is on 8pt; we pick 4pt because it lets cards breathe at the smaller window sizes the desktop app uses):

- Spacing tokens: `xs (4) / sm (8) / md (12) / lg (16) / xl (24) / 2xl (32) / 3xl (48)`
- Card padding: `xl` (24pt) horizontally + `lg` (16pt) vertically by default.
- Card gap (between stacked cards): `lg` (16pt).
- Radius tokens: `sm (6) / md (10) / lg (14) / xl (20) / pill (9999)`. Cards use `lg`. Buttons use `md` (regular) or `pill` (CTA).

### 4. Shadows

Three layered shadow tiers — never use the SwiftUI default shadow:

- `shadow.subtle`: `y=1, blur=2, alpha=0.04` + `y=0, blur=1, alpha=0.06`. Default cards.
- `shadow.raised`: `y=4, blur=12, alpha=0.06` + `y=1, blur=2, alpha=0.04`. Hovered cards, popovers, settings sheet.
- `shadow.brand`: `y=4, blur=20, alpha=0.16` of the accent color. Primary CTA hover state only.

### 5. Custom controls

A small replacement set for the SwiftUI defaults that look most "system":

- **`PrimaryButton`** — pill-radius, `bg = accent.primary`, `text.lg` white, `body.lg medium`. Hover: `shadow.brand`, lifts 1pt on press, accent darkens 8%. Disabled: `bg.subtle` + `text.tertiary`. (Replaces every `.borderedProminent`.)
- **`SecondaryButton`** — pill-radius, `bg = bg.surface`, `border.strong` 1px, `text.primary`, `body.lg medium`. (Replaces every default Button.)
- **`IconButton`** — circular 32×32, `bg = bg.subtle`, hover `bg = accent.muted`. For settings gear, account menu trigger, refresh.
- **`SegmentedControl`** — pill container, slider thumb that animates to selected segment in 180ms `.spring`. Replaces the current CaptureModeSelector ad-hoc rendering.
- **`Field`** — text input with `bg = bg.subtle`, `border.subtle` 1px, focused border = `accent.primary`. Replaces every default TextField.
- **`Pill`** — small status badge, `body.sm`, padded `sm md`, configurable color (success / warning / recording / muted). Replaces the ad-hoc state pills currently in `PermissionsView`.
- **`StatusDot`** — 8×8 colored dot + label, used in connection / integration status indicators.

All in `desktop/Sources/LoomDesktopApp/UI/DesignSystem/Controls/`. Each renders correctly in both color schemes and exposes a `.disabled` / `.loading` state.

### 6. Motion

A single `LoomolaMotion` namespace exposes the curves + durations used app-wide:

- `quick`: `.easeInOut(duration: 0.12)` — hover, focus, color changes.
- `medium`: `.spring(duration: 0.18, bounce: 0.10)` — segment slider, sheet open/close, card raise on hover.
- `expressive`: `.spring(duration: 0.34, bounce: 0.22)` — recording start "punch in" effect on the HUD.

When `accessibilityReduceMotion` is true, all three collapse to instant.

---

## Layout restructure (what moves where)

### Main window — signed-in idle state (the 95% case)

```
┌─────────────────────────────────────────────────┐
│  ◉ ◉ ◉   [Loomola wordmark]      ⚙   🟢 IC    │  ← Custom title bar (40pt tall)
├─────────────────────────────────────────────────┤
│                                                 │
│   Capture                                       │  ← display.xl
│                                                 │
│   ┌───────────────────────────────────────────┐ │  ← Hero card (rounded lg, shadow.subtle)
│   │                                           │ │     padding: xl
│   │  [📹 Start recording]   [🎙 Audio note]    │ │  ← PrimaryButton + SecondaryButton
│   │                                           │ │
│   │  [▼ Mic: System default]  [▼ Cam: ...]   │ │  ← Inline pickers (custom Picker style)
│   │                                           │ │
│   └───────────────────────────────────────────┘ │
│                                                 │
│   ┌─ Meeting ready ──────────────────────────┐ │  ← Conditional, only when detected
│   │ "Sprint planning" • Google Meet           │ │     (existing MeetingPromptView, restyled)
│   │                            [Start audio]  │ │
│   └───────────────────────────────────────────┘ │
│                                                 │
│   Recent                                        │  ← display.lg
│                                                 │
│   ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐         │  ← 4 cards, ~140×140 each
│   │ thumb│ │ thumb│ │ thumb│ │ thumb│         │
│   │      │ │      │ │      │ │      │         │
│   │ Title│ │ Title│ │ Title│ │ Title│         │
│   │ 4m ago│ │ 2h ago│ │ 1d ago│ │ 3d ago│      │
│   └──────┘ └──────┘ └──────┘ └──────┘         │
│                                                 │
└─────────────────────────────────────────────────┘
```

**Composition:**

- **Custom title bar.** AppKit `NSWindow.titlebarAppearsTransparent = true` + `titleVisibility = .hidden` + `styleMask` retains the traffic lights. We draw our own bar inside the window content. Holds: traffic lights inset 12pt (cocoa default), Loomola wordmark centered-left, settings gear icon (right), account avatar/menu (far right, shows initial as a circle).
- **Hero CTA card.** `bg.surface`, `radius.lg`, `shadow.subtle`. Houses the two action buttons + two inline pickers. Picker style matches the new `Field` token, not default `Picker.menu`. Pickers persist to UserDefaults the same way M2 does — moved from a separate "Source picker" card up into the hero so the user makes their picks in one place.
- **Meeting prompt card.** Existing MeetingPromptView, restyled with new tokens. Same data flow.
- **Recent strip.** New view. Backed by a new `RecentRecordingsService` that hits `GET /api/recordings?limit=6` (paginated; we already have the endpoint) on app foreground + after every successful upload. Cards show: thumbnail (existing R2 thumbnail key, signed URL), title, relative timestamp. Click → `NSWorkspace.shared.open(URL("https://loom.dissonance.cloud/recordings/<slug>"))`. Right-click → contextual menu (Copy link, Open in browser).
- **No footer.** `Refresh sources`, `Open Library`, `Sign out`, `Open Dashboard` all moved (see *Settings sheet* and *Title bar account menu* below).
- **No more `CaptureSourcesView` / `IntegrationsCard` / `StatusCard` / `DeveloperToolsDisclosure` always visible.** All in settings or removed.

### Recording state (when a video composite recording starts)

The main window content fades out (250ms) and is replaced by a centered "Recording" surface — same window, different content:

```
┌─────────────────────────────────────────────────┐
│  ◉ ◉ ◉   [Loomola wordmark]      ⚙   🟢 IC    │
├─────────────────────────────────────────────────┤
│                                                 │
│              ●  Recording                       │  ← Pulsing red dot + state label
│              02:14                              │  ← mono.timer
│                                                 │
│         ▁▃▅▇▅▃▁                                 │  ← Live waveform (mic level)
│                                                 │
│   ┌──────────────┐  ┌──────────────┐            │
│   │  ⏹  Stop     │  │  🗑  Discard  │            │
│   └──────────────┘  └──────────────┘            │
│                                                 │
└─────────────────────────────────────────────────┘
```

Mirrors the existing recording HUD but at main-window scale. (The HUD itself stays — it's the on-screen-during-recording surface; the main window's recording state is what users see if they happen to bring the main window to front.)

### Recording state (audio note)

Same shape as video, but the buttons are Stop / Discard / Open note (matches the existing audio recording flow).

### Settings sheet

Slides up from the bottom of the main window (or presented as a sheet) when settings gear is clicked. Sections:

```
Settings
├── Sources
│   ├── Camera (Picker)
│   ├── Microphone (Picker)
│   └── Refresh sources [SecondaryButton]
├── Permissions  (only shown if any required permission is missing or denied)
│   ├── Camera • status pill
│   ├── Microphone • status pill
│   ├── Screen recording • status pill
│   └── Accessibility • status pill (optional)
├── Integrations
│   ├── Chrome bridge: Install / Open extension folder
│   └── Obsidian: Sync now
├── Diagnostics  (collapsible, collapsed by default)
│   ├── Test video backend
│   ├── Test audio backend
│   └── Capture sources detail (the old CaptureSourcesView)
└── Account
    ├── Signed in as theiancross@gmail.com
    ├── Open dashboard
    └── Sign out
```

Sheet uses `bg.surface`, `shadow.raised`, `radius.xl`. Inherits color scheme. Closed via top-right ✕ or Esc.

### Account menu (title bar, far right)

Click the avatar circle to open a small popover (`NSPopover` with custom view):

```
┌─────────────────────────┐
│ theiancross@gmail.com    │
│ Pro plan • 12.4 GB used  │  ← (storage/plan optional, may defer)
├─────────────────────────┤
│ Open dashboard           │
│ Open library             │
├─────────────────────────┤
│ Sign out                 │
└─────────────────────────┘
```

### Signed-out screen

Replaces the current basic form:

```
┌─────────────────────────────────────────────────┐
│  ◉ ◉ ◉                                          │
├─────────────────────────────────────────────────┤
│                                                 │
│              [Loomola glyph, 64pt]              │
│                                                 │
│              Capture, restored.                 │  ← display.xl, brand line
│                                                 │
│      Self-hosted screen recording + AI         │
│      meeting notes. One workspace.              │
│                                                 │
│              ┌───────────────────┐              │
│              │ [📧 Email]         │              │  ← Field
│              └───────────────────┘              │
│              ┌───────────────────┐              │
│              │ [🔒 Password]      │              │  ← Field
│              └───────────────────┘              │
│              ┌───────────────────┐              │
│              │  Sign in →        │              │  ← PrimaryButton (full width)
│              └───────────────────┘              │
│                                                 │
│              Trouble signing in?                │  ← link to dashboard reset flow
│                                                 │
└─────────────────────────────────────────────────┘
```

Centered vertically + horizontally. Fields use the new `Field` token. Tagline + glyph make this a brand moment, not a system login.

### Permissions preflight

When at least one required permission is missing AND the user hasn't dismissed via "I'll do this later":

- The hero card is replaced by a permissions card with the same shape (rounded, shadow.subtle, padding xl).
- Each permission is a row with an icon, title, one-line description, and a status pill on the right.
- A single CTA at the bottom: `Grant access →`. Clicking it walks through Camera → Microphone → Screen recording sequentially (with deep-links to System Settings as fallback). Once all granted, the card swaps in (animated) for the regular hero card.

This is *the same logic* as the existing `PermissionsView` but presented as a hero state when active rather than as a banner stacked above other content.

### Empty / first-launch state (signed in but never recorded)

The Recent strip section is replaced by an empty-state illustration + tagline:

```
┌──────────────────────────────────────────────────┐
│                                                  │
│            [subtle illustration, 80pt]          │
│                                                  │
│            Nothing recorded yet.                 │
│      Hit Start recording or press ⌥⇧R to begin.  │
│                                                  │
└──────────────────────────────────────────────────┘
```

Once the first recording uploads, this swaps to the Recent strip.

---

## Per-screen acceptance criteria

### Title bar
- Custom title bar replaces the system one. Traffic lights stay clickable and at native position.
- Loomola wordmark is visible center-left at all window widths down to 540pt (the minimum we'll support).
- Settings gear opens the settings sheet.
- Account menu opens the account popover.

### Main window — idle
- Page headline "Capture" is the first piece of body content below the title bar.
- The hero card is the largest surface in the viewport; it's where the eye lands first.
- Two CTAs ("Start recording" / "Audio note") are reachable in 0 tabs from app launch.
- Mic + camera pickers update UserDefaults on selection (existing behavior).
- The Recent strip shows the user's last 4 recordings within ~500ms of the window appearing (network-dependent but it shouldn't block first paint — empty cards as skeletons during fetch).
- Clicking a recent card opens its share page in the default browser.
- No `CaptureSourcesView`, `IntegrationsCard`, or `StatusCard` is ever visible on the main view.

### Main window — recording (video)
- Within 200ms of pressing Start, the main window content fades to the recording surface.
- The pulsing red dot pulses at 1Hz and respects reduce-motion.
- The mono timer increments every second and never jumps frames.
- Stop and Discard route to the same view-model methods as the existing HUD.
- The on-screen HUD (existing, top-center floating) continues to show — this is the *main-window* representation.
- When recording stops successfully, the main window swaps back to the idle state (hero + recent), with the freshly-uploaded recording as the first item in Recent.

### Main window — recording (audio)
- Same shape as video, but the audio note's title (if set) appears below "Recording".
- Discard / Stop / Open note route to the existing audio note view-model methods.

### Settings sheet
- Opens within 180ms of clicking the gear (no janky pop-in).
- Camera + mic pickers reflect the same UserDefaults values as the hero card; selecting in one updates the other.
- Permissions section shows only if `permissionStatus.requiredMissing == true` OR any permission is `.denied`. Otherwise hidden.
- Integrations section retains existing behaviors (Install Chrome bridge, Open extension folder, Sync Now).
- Diagnostics is collapsed by default; expanding shows the existing two test buttons + the existing CaptureSourcesView block.
- Account section shows the user's email + Sign out + Open dashboard.

### Account menu
- Avatar shows the first letter of the user's email in `accent.primary` text on `accent.muted` fill.
- Sign out routes to `viewModel.signOut()`.
- Open dashboard / Open library both route to `https://loom.dissonance.cloud`.

### Signed-out screen
- Loads with focus on the email field.
- Sign in button is disabled until both fields have content.
- Returning a failed login flashes the field border `accent.warning` for 1.5s and shows error copy below the form (single line, not a blocking modal).

### Permissions preflight
- When active, no other content is shown above-the-fold (hero card is replaced).
- Once all required permissions are granted, the card transitions to the regular hero card in `medium` motion.
- A "Skip for now" link in the permissions card hides it for the session (returns next launch); same data path as today.

### Empty Recent state
- Renders only when the API returns 0 recordings AND 0 notes.
- Does not flash on app open while data loads (skeleton state during fetch).

### Visual regression catch-all
- No view in the app uses `Color(nsColor: .windowBackgroundColor)` or `Color(nsColor: .controlBackgroundColor)` after this milestone — all tokens come from `DS.color.*`.
- No view uses `.borderedProminent` button style after this milestone — all CTAs come from `PrimaryButton` / `SecondaryButton` / `IconButton`.
- No view hard-codes a font name or size — all type comes from `DS.font.*`.
- No view hard-codes a corner radius or padding number — all from `DS.radius.*` / `DS.spacing.*`.

---

## Architecture changes

| Area | M2 state | M3 state |
|---|---|---|
| Color | `Color(nsColor: ...)` semantic colors | `DS.color.*` tokens with explicit light/dark values, scheme-switched at the root |
| Type | System font, default sizes | Inter + JetBrains Mono registered at app launch; `DS.font.*` tokens with consistent line height + tracking |
| Spacing | Magic numbers (e.g., `padding(24)`, `spacing: 18`) | `DS.spacing.*` tokens (`xs / sm / md / lg / xl / 2xl / 3xl`) |
| Radii / shadows | Default SwiftUI / occasional ad-hoc | `DS.radius.*` + `DS.shadow.*` |
| Buttons | `.borderedProminent` / `.bordered` defaults | `PrimaryButton`, `SecondaryButton`, `IconButton` |
| Pickers | `Picker.menu` default style | New `FieldPicker` (matches Field input style) |
| Top of window | System title bar with "Loomola Desktop" string | Custom title bar with wordmark + gear + account menu |
| Main window layout | One ScrollView stacking 8+ cards always visible | One main view per state: idle (hero + recent) / recording-video / recording-audio / signed-out / permissions-preflight |
| Settings | None — all settings always visible | Settings sheet presented from the gear icon |
| Recent activity | None | New `RecentRecordingsService` + `RecentStrip` view, hits `/api/recordings?limit=6` |
| Motion | None / instant | `LoomolaMotion` namespace; eased transitions on every state change; reduce-motion-aware |
| Status copy | Engineering-voice strings interleaved into the UI | Status moved out of the main surface into a small `StatusDot` in the title bar; one-word states; verbose detail in Settings → Diagnostics |
| `MainRecorderView.swift` | One file, ~870 lines, every section inline | One file becomes a router by `(state, recordingKind)` → swaps `IdleHomeView` / `RecordingHomeView` / `SignedOutView` / `PermissionsHomeView` (each its own file) |

### File tree additions

```
desktop/Sources/LoomDesktopApp/UI/
├── DesignSystem/
│   ├── Tokens/
│   │   ├── DSColor.swift
│   │   ├── DSFont.swift
│   │   ├── DSSpacing.swift
│   │   ├── DSRadius.swift
│   │   ├── DSShadow.swift
│   │   └── LoomolaMotion.swift
│   ├── Controls/
│   │   ├── PrimaryButton.swift
│   │   ├── SecondaryButton.swift
│   │   ├── IconButton.swift
│   │   ├── SegmentedControl.swift
│   │   ├── Field.swift
│   │   ├── FieldPicker.swift
│   │   ├── Pill.swift
│   │   └── StatusDot.swift
│   └── Card.swift   (existing — extended to use new tokens)
├── Home/
│   ├── IdleHomeView.swift
│   ├── RecordingHomeView.swift
│   ├── PermissionsHomeView.swift
│   └── SignedOutHomeView.swift
├── Shell/
│   ├── CustomTitleBar.swift
│   ├── AccountMenuPopover.swift
│   └── SettingsSheet.swift
├── Recent/
│   ├── RecentStrip.swift
│   ├── RecentCard.swift
│   └── RecentRecordingsService.swift
└── MainRecorderView.swift  (becomes a thin router; ~150 lines instead of 870)
```

`desktop/Resources/Fonts/` — new directory with `Inter-Variable.ttf` + `JetBrainsMono-Variable.ttf`. Registered in `LoomDesktopApp.init()` via `CTFontManagerRegisterFontsForURL`.

### Backwards-compatible state machine

`RecorderViewModel` does not change. The router in `MainRecorderView` reads `(viewModel.state, viewModel.activeRecordingKind, permissionStatus)` and picks one of the four home views. Every callback that the new views need (start recording, sign out, etc.) is a method that already exists on the view model.

### Recent recordings service

```swift
@MainActor
final class RecentRecordingsService: ObservableObject {
    @Published private(set) var items: [RecentRecording] = []
    @Published private(set) var isLoading = false
    @Published private(set) var lastError: String?

    func refresh() async { ... }    // hits GET /api/recordings?limit=6 via existing BackendClient
}
```

Auto-refresh triggers:
- On app foreground (`NSApplication.didBecomeActiveNotification`).
- After every `viewModel.state` transition into `.complete(slug:)`.
- 60 seconds after last refresh while the window is visible.

`RecentRecording` is a small DTO: `id`, `slug`, `title`, `thumbnailURL?`, `createdAt`, `durationSeconds?`, `kind: .video | .audio`. Thumbnails are signed URLs from R2 (existing endpoint `/api/recordings/[id]/thumbnail-url` — or we add a list-side variant if needed; preferable to send signed URLs in the list response so we don't N+1).

---

## Data needed from the web app

We may need one small backend addition:

- **`GET /api/recordings?limit=6` returning slim cards.** The existing dashboard already paginates; we just need to ensure (a) the desktop app's auth flow can hit it (it's an authenticated endpoint, our `BackendClient` already handles tokens), and (b) the response includes a signed thumbnail URL inline so the desktop doesn't N+1. If the current shape doesn't include thumbnail URLs, add a small `thumbnailUrl: string | null` to the response (~5 LOC change in `src/lib/api/recordings/list.ts`).

If the web change is non-trivial we can defer the thumbnail and ship a typography-only card initially.

---

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Custom title bar interferes with full-screen / Stage Manager | Window controls disappear or jump | Stick with `titlebarAppearsTransparent` + `titleVisibility = .hidden` + standard window mask — the safe pattern. Test full-screen + Stage Manager + Spaces explicitly before merging. |
| Inter font registration fails silently | Whole app falls back to system font; visual regression | Log success/failure in `LoomDesktopApp.init`; fail loud in dev (assert), graceful in release (system fallback) |
| Settings sheet overflow on small windows | Content gets cut | Settings sheet is its own scroll view; min window content size raised to 560×620 |
| Recent strip thumbnail loads block first paint | Window appears blank for 500ms+ | Skeleton placeholders render immediately; thumbnails fade in as they arrive |
| Refactor regresses M2 functionality | Composite recorder, HUD, permissions, hotkeys break | The router is purely view-layer — no view-model methods change signature. Heavy manual smoke before merge |
| Visual regression on existing surfaces (audio recording panel, meeting prompt) | Look inconsistent with new shell | Restyle those panels to use new tokens as part of M3 (small, in-scope) |
| File tree bloat (4 home views + 8 controls) | Codebase feels heavier | Acceptable cost for the polish bar; each file is small (≤ 150 LOC) and single-purpose |
| Picker behavior regression (FieldPicker custom impl) | Dropdowns don't work | FieldPicker wraps `NSPopUpButton` via `NSViewRepresentable` rather than reimplementing. Battle-tested AppKit primitive. |
| Color tokens drift from web `--accent` | Brand inconsistency | Tokens documented in spec; first cut matches the web `accent` of `#3B82F6`. If web brand ever changes, both sides update. |
| Status copy refactor loses dev signal | Hard to debug | Verbose status moves to Settings → Diagnostics, not removed. The `statusMessage` field stays on the view model for debug; only its surfacing in the main view changes. |

---

## Open questions

- **Is "Capture, restored." the right brand line on signed-out?** Placeholder. Could be "Self-hosted Loom + Granola, in one app." or "Recording you own." or anything tighter. **Decision pending Ian's call.**
- **Bundle Inter or use system SF?** Inter is the closest free font to GT America / Söhne (Granola's vibe). SF Pro is the macOS default and free. Inter is more distinctive; SF Pro is invisible. Recommend Inter.
- **Recent strip count: 4 or 6?** 4 fits cleaner at narrower window widths; 6 shows more activity. Recommend 4 with a "View all →" link to the dashboard.
- **Settings as a sheet vs. a separate window?** Sheet keeps the user in flow; separate window is more native to macOS preferences. Recommend sheet because the app is a single-window app and keeping it that way is simpler.
- **Do we ship a custom dock icon variant?** A subtle update (warmer color, thinner stroke) would fit the new palette. Defer to a follow-up — not on the critical path.
- **Recording state: replace main view or overlay it?** Spec says replace. Argument for overlay: when recording, the user can still see Recent and pick another action. But Granola is firmly "recording = recording, full attention." Recommend replace (spec'd).
- **Audio recording panel + meeting prompt window — restyle in M3 or leave them as-is for now?** Restyling is small (~1 hour each). Recommend in-scope.

---

## Out of scope (deferred to M4 or later)

- Onboarding tour for new users (welcome carousel).
- Storage / plan indicators in the account popover.
- VoiceOver / Dynamic Type / accessibility audit.
- Localization (English only in M3).
- Animated icon transitions on the menubar item.
- Window restoration (remembering window position + size across launches — `NSWindow.setFrameAutosaveName` pass).
- Custom dock icon variant.
- Notifications (recording uploaded toast via `UNNotification`).
- Sounds on recording start / stop / upload.
- Drag-and-drop a video file into the main window to upload.
- Right-click on a Recent card → contextual actions beyond "Open in browser" / "Copy link" (e.g., delete, rename — those stay on the web).
- Search box in the main window (the web has search; the desktop is record-first, browse-second).

---

## What success looks like

After M3 ships, an outsider opens the app for the first time and:

1. **Signed-out screen** is a brand moment — they remember the wordmark, tagline, and color before they remember what the app does.
2. They sign in. The window animates to the **idle home**: a single big "Capture" page with one obvious CTA cluster and a strip of Recent activity. Nothing in the viewport reads as "developer tool."
3. They press **Start recording**. The window content fades to a centered Recording surface; the on-screen HUD pulses; the elapsed timer ticks. They feel in control.
4. They press Stop. The window fades back to idle; a fresh card appears at the head of Recent. They see what just happened.
5. If they need to change a setting, they click the **gear** in the title bar; a sheet slides up; they change camera; sheet closes; they keep working.
6. At no point do they see a "This is a dev build" string, a stack of always-visible cards, a default `Picker.menu` dropdown, or a system-style button. Every surface they touch reads as **the same product**.

That's the bar. If a Granola or Loom user can't tell our shell from theirs without poking around, we hit it.
