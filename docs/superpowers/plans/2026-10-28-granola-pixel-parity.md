# Granola Pixel Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the meeting-note surfaces of the Loomola macOS app look and behave like Granola 7.700.0, in the ten ranked changes Ian approved on 2026-10-28.

**Architecture:** All work lands in `desktop/` (SwiftUI + AppKit). Visual tokens change first so every later surface inherits them; the home shell and the note workspace are restructured next; pure-logic helpers (date grouping, transcript grouping, echo dedup, upcoming-events grouping) are extracted into small files with unit tests. One server change (rank 6) makes the live transcript usable for immediate enhancement.

**Tech Stack:** Swift 5 / SwiftUI / AppKit, SwiftPM (`desktop/Package.swift`), XCTest (`swift test` in `desktop/`), Next.js route handlers for the one server change.

**Spec:** `docs/superpowers/specs/2026-10-28-granola-pixel-parity-audit.md` (approved list: all 10 ranks; timer hidden like Granola; Newsreader for the serif; do not read Granola's bundle).

## Global Constraints

- Branch `feat/granola-pixel-parity` in the worktree `~/Development/03Utilities/Loom_Clone-granola-parity`; one commit per task; never push.
- Every colour goes through `DSColor`, every font through `DSFont`; no new ad-hoc hex values outside `DSColor.swift` and `MarkdownTextEditor.swift`'s style table.
- Logger subsystem stays `cloud.dissonance.loom.desktop`. No secrets in commits.
- Speaker UI stays on the existing accept/dismiss/label endpoints with `transcriptVersion` (speaker v2 lock rules); this plan only restyles it.
- Web app and backend untouched except Task 7's enhancement trigger.
- After each task: `swift build` (in `desktop/`), `./scripts/install-local-app.sh`, screenshot the changed surface with the computer-use `app_screenshot` tool, save as `docs/Granola UI Screenshots/2026-10-28-parity/after-<NN>-<surface>.jpg`.
- Dark mode is the reference (Ian runs dark); light values are derived from Granola's docs palette (#F2F2EC family) and checked once at the end.

## Review Focus

1. A note with no calendar event and no attendees: the date popover must still open and show "Add attendees…"; test in Task 4 (`DatePillModel` with nil event).
2. A recording with the mic muted and only system audio: the transcript tab must show "Call audio" runs without an empty "Me" run; test in Task 5 (`TranscriptRunGrouper` with a single source).
3. A transcript where the same sentence arrives on mic 300 ms after system audio (speaker echo): only one run appears; test in Task 5 (`LiveTranscriptEchoSuppressor` window).
4. Stop pressed before any live transcript text exists: the generate pill must say "No transcript yet" and not spin forever; test in Task 7 (`EnhanceTrigger.decision(for:)` with empty live text).
5. The home list with 300 notes re-rendering once per second during a recording: grouping must not allocate formatters per row; test in Task 3 (`RecentDateGrouping` formatter identity + a 300-row timing assertion under 50 ms).

---

### Task 1: Granola palette and lime accent (rank 1)

**Files:**
- Modify: `desktop/Sources/LoomDesktopApp/UI/DesignSystem/Tokens/DSColor.swift`
- Modify: `desktop/Sources/LoomDesktopApp/UI/Notes/MarkdownTextEditor.swift` (colour table only)
- Test: `desktop/Tests/LoomDesktopTests/DesignSystemTests.swift`

**Interfaces:**
- Produces: `DSColor.Accent.ai` (lime, for Generate/Enhanced), `DSColor.Accent.calendar` (purple event bar), existing names keep their roles.

- [ ] **Step 1: Write the failing test** in `DesignSystemTests.swift`:

```swift
func testGranolaDarkNeutrals() {
    XCTAssertEqual(DSColor.hex(DSColor.Bg.canvas, dark: true), "#252525")
    XCTAssertEqual(DSColor.hex(DSColor.Bg.sidebar, dark: true), "#1E1E1E")
    XCTAssertEqual(DSColor.hex(DSColor.Bg.surface, dark: true), "#2F2F2F")
    XCTAssertEqual(DSColor.hex(DSColor.Text.primary, dark: true), "#E8E8E6")
    XCTAssertEqual(DSColor.hex(DSColor.Text.secondary, dark: true), "#C8C8C6")
    XCTAssertEqual(DSColor.hex(DSColor.Text.tertiary, dark: true), "#8E8E8C")
    XCTAssertEqual(DSColor.hex(DSColor.Accent.ai, dark: true), "#B2C248")
    XCTAssertEqual(DSColor.hex(DSColor.Accent.ai, dark: false), "#788C15")
    XCTAssertEqual(DSColor.hex(DSColor.Bg.canvas, dark: false), "#F2F2EC")
}
```

- [ ] **Step 2: Run** `swift test --filter DesignSystemTests` → FAIL (`hex`, `sidebar`, `ai` undefined).
- [ ] **Step 3: Implement** in `DSColor.swift`: add `static func hex(_ color: Color, dark: Bool) -> String` (resolve through `NSColor` with `NSAppearance(named: dark ? .darkAqua : .aqua)`, sRGB, uppercase `#RRGGBB`); add `Bg.sidebar`; re-point values:
  - dark: canvas #252525, sidebar #1E1E1E, surface #2F2F2F, surfaceRaised #363635, subtle #2A2A2A, text primary #E8E8E6 / secondary #C8C8C6 / tertiary #8E8E8C, border subtle #3A3A3A / strong #484848.
  - light: canvas #F2F2EC, sidebar #EAEAE3, surface #FFFFFF, surfaceRaised #FFFFFF, subtle #E6E6DF, text primary #1F1F1D / secondary #4A4A47 / tertiary #7A7A76, border subtle #E3E3DC / strong #CFCFC6.
  - `Accent.ai` #788C15 light / #B2C248 dark; `Accent.aiMuted` = ai at 0.16; `Accent.calendar` #8B5CF6 both; `Accent.primary` stays blue (video product only).
- [ ] **Step 4: Point the AI surfaces at the lime**: in `NoteWorkspaceView.swift` replace `DSColor.State.success` with `DSColor.Accent.ai` in `generateActionPill`, `writingNotesBar`, `notesModePill` active icon, and the "Notes updated" check; in `MarkdownTextEditor.swift` set dark body text #C8C8C6, heading #E8E8E6, placeholder #8E8E8C, bullet #8E8E8C; light body #2E2F35 unchanged, heading #1F1F1D.
- [ ] **Step 5: Run** `swift test` → PASS; `swift build` clean.
- [ ] **Step 6: Install, screenshot home and a finished note** → `after-01-home.jpg`, `after-01-finished-note.jpg`.
- [ ] **Step 7: Commit** `desktop: Granola neutral palette and lime AI accent (parity rank 1)`.

### Task 2: Newsreader serif and type scale (rank 5, pulled forward because ranks 2–4 lay out text)

**Files:**
- Create: `desktop/Sources/LoomDesktopApp/Resources/Fonts/Newsreader-VariableFont.ttf`, `Newsreader-Italic-VariableFont.ttf`, `Resources/Fonts/OFL-Newsreader.txt` (from google/fonts `ofl/newsreader`, already downloaded to the session scratchpad `fonts-dl/`)
- Modify: `UI/DesignSystem/FontLoader.swift`, `UI/DesignSystem/Tokens/DSFont.swift`, `UI/Notes/NoteWorkspaceView.swift` (`titleEditor`), `UI/Notes/MarkdownTextEditor.swift` (sizes and spacing)
- Test: `desktop/Tests/LoomDesktopTests/DesignSystemTests.swift`, `MarkdownRenderingStyleTests.swift`

**Interfaces:**
- Produces: `DSFont.Serif.title()` (Newsreader 30 regular, opsz 30), `DSFont.Serif.display()` (Newsreader 26 regular, for "Coming up"), `FontLoader.newsreaderFamilyName = "Newsreader"`.

- [ ] **Step 1: Write the failing tests**:

```swift
func testNewsreaderRegisters() {
    FontLoader.registerAll()
    XCTAssertNotNil(NSFont(name: "Newsreader", size: 30))
}
func testMarkdownBodyMetrics() {
    let s = MarkdownStyle.current(dark: true)
    XCTAssertEqual(s.bodyFont.pointSize, 16)
    XCTAssertEqual(s.bodyLineSpacing, 9.6, accuracy: 0.01)   // 16 × 1.6 − 16
    XCTAssertEqual(s.paragraphSpacing, 20)
    XCTAssertEqual(s.headingGutterMarker, "#")
}
```

- [ ] **Step 2: Run** `swift test --filter 'DesignSystemTests|MarkdownRenderingStyleTests'` → FAIL.
- [ ] **Step 3: Implement**: copy the three files into `Resources/Fonts/`; `FontLoader.registerAll()` registers both Newsreader files; `DSFont.Serif.title()` = `Font.custom("Newsreader", size: 30)` with system-serif fallback; `titleEditor` uses it with `lineSpacing 3`; `MarkdownStyle` exposes `bodyLineSpacing`, `paragraphSpacing`, `headingGutterMarker` and draws the marker in the left gutter at x−18 in `Text.tertiary` for H1–H3 (replacing the hidden `#` run); headings H1 20 / H2 18 / H3 16 semibold in Inter (SF fallback), body 16 regular, bullets • top-level and ○ nested at 5pt.
- [ ] **Step 4: Run** `swift test` → PASS. Install, screenshot the finished note → `after-02-finished-note-type.jpg`.
- [ ] **Step 5: Commit** `desktop: Newsreader title serif and Granola body metrics (parity rank 5)`.

### Task 3: Home shell — sidebar by default, Coming up, Granola rows (rank 2)

**Files:**
- Create: `UI/Home/ComingUpSection.swift`, `UI/Home/ComingUpGrouping.swift`
- Modify: `UI/MainRecorderView.swift` (sidebar default, `+ New note`, search icon), `UI/Shell/SidebarPanel.swift` (fixed 192pt, Home/Favorites/Spaces, footer), `UI/Home/IdleHomeView.swift`, `UI/Home/HeroCaptureSection.swift` (video only), `UI/Recent/RecentStrip.swift`, `UI/Recent/RecentNoteRow.swift`, `UI/Recent/RecentDateGrouping.swift`, `UI/Recent/RecentRecordingsService.swift` (attendee names + suggested folder in the DTO if the recent route already returns them; otherwise show "Me")
- Test: `Tests/LoomDesktopTests/RecentDateGroupingTests.swift`, new `ComingUpGroupingTests.swift`

**Interfaces:**
- Consumes: `CalendarAttendeeService.eventsStarting(after:before:)`, `CalendarEventCandidate`.
- Produces: `ComingUpGrouping.days(from events: [CalendarEventCandidate], now: Date, calendar: Calendar) -> [ComingUpDay]` where `ComingUpDay { dayNumber: String; monthLabel: String; weekdayLabel: String; isToday: Bool; events: [CalendarEventCandidate] }`; `RecentDateGrouping` keeps its signatures but uses three cached `static let` formatters.

- [ ] **Step 1: Write the failing tests**:

```swift
func testGroupingReusesFormatters() {
    XCTAssertTrue(RecentDateGrouping.weekdayFormatter === RecentDateGrouping.weekdayFormatter)
    let items = (0..<300).map { i in RecentRecording.fixture(createdAt: Date().addingTimeInterval(-Double(i) * 36_000)) }
    measure { _ = RecentDateGrouping.grouped(items) }   // assert average < 0.05 s via XCTMeasureOptions
}
func testComingUpGroupsByDayAndMarksToday() {
    let now = ISO8601DateFormatter().date(from: "2026-10-28T19:00:00Z")!
    let days = ComingUpGrouping.days(from: [evt("A", "2026-10-28T21:00:00Z"), evt("B", "2026-10-29T15:00:00Z")], now: now, calendar: utc)
    XCTAssertEqual(days.map(\.dayNumber), ["28", "29"])
    XCTAssertEqual(days.map(\.isToday), [true, false])
    XCTAssertEqual(days[1].weekdayLabel, "Thu")
}
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** the helpers, then the views:
  - `MainRecorderView`: `sidebarOpen` defaults to `true` when `captureMode == .audio`; `homeTitleBar` right side becomes `[ magnifyingglass ] [ + New note ]` pill buttons (New note = `viewModel.startAudioNoteRecording()`); wordmark stays left; gear + avatar move into the sidebar footer.
  - `SidebarPanel`: width 192, background `Bg.sidebar`; sections Home / Favorites / Spaces; footer row with gear (settings) and avatar.
  - `IdleHomeView` (audio mode): `ComingUpSection` (serif "Coming up" heading, card with day rows: 28pt serif day number, 11pt month + weekday stacked, 2×36 `Accent.calendar` bar, title `Body.lg` regular, time range `Body.sm` tertiary) then `RecentStrip` without the "Recent notes" heading; column `maxWidth 640` centred. Video mode keeps the hero card.
  - `RecentNoteRow`: height 48; subtitle "Me" (or attendee names when the DTO has them) `Body.sm` tertiary under the title; right side: suggested-folder pill `Add to ▸ [folder] ✓ ✕` when `suggestedFolderId != nil` (uses existing accept/dismiss endpoints), else folder icon only when filed; time as "9:44 AM" with small-caps AM/PM (`Body.sm` + `.textCase(.uppercase)` at 10pt).
- [ ] **Step 4: Run** `swift test` → PASS. Install, screenshot home → `after-03-home.jpg`; compare with `granola-01-home.jpg`.
- [ ] **Step 5: Commit** `desktop: Granola home shell with sidebar, Coming up and row layout (parity rank 2)`.

### Task 4: Note header — segmented pill, Stop/Resume, date pill right (rank 3)

**Files:**
- Create: `UI/Notes/NoteHeaderBar.swift` (segmented `[My notes │ Transcript]` → `[Enhanced │ Transcript]`, Stop/Resume pill, trailing date pill), `UI/Notes/DatePillModel.swift`
- Modify: `UI/Notes/NoteWorkspaceView.swift` (`pillRow` → `NoteHeaderBar`, move `mePill` content into the date popover, move folder + template into the top-right cluster of Task 9), `UI/RecorderViewModel.swift` (`resumeStoppedAudioNote` is NOT built: Resume after stop reuses the existing pause/resume while recording; after upload the pill shows `🎙 Resume` disabled with help text "Resume lands with the next release")
- Test: new `Tests/LoomDesktopTests/DatePillModelTests.swift`

**Interfaces:**
- Produces: `DatePillModel.label(for createdAt: Date, now: Date, calendar: Calendar) -> String` ("Today" / "Yesterday" / "Mon, Oct 26"); `NoteHeaderBar(mode: NoteHeaderMode, isRecording: Bool, isPaused: Bool, onStop:, onPause:, onResume:, dateLabel:, onDate:)`.

- [ ] **Step 1: Write the failing test**:

```swift
func testDatePillLabels() {
    let now = ISO8601DateFormatter().date(from: "2026-10-28T19:00:00Z")!
    XCTAssertEqual(DatePillModel.label(for: now.addingTimeInterval(-3600), now: now, calendar: utc), "Today")
    XCTAssertEqual(DatePillModel.label(for: now.addingTimeInterval(-86_400), now: now, calendar: utc), "Yesterday")
    XCTAssertEqual(DatePillModel.label(for: now.addingTimeInterval(-2 * 86_400), now: now, calendar: utc), "Mon, Oct 26")
}
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement**: header row = `NoteHeaderBar` with the segmented pill (dark `Bg.surface` capsule, active segment `Bg.surfaceRaised`, inactive segment shows icon only; Transcript segment shows three `Accent.ai` dots pulsing while recording), `■ Stop` pill (white square 10pt + "Stop" `Body.md` medium, `Bg.surfaceRaised`, 1pt border) while recording, `⏸ Pause`/`▶ Resume` as a secondary item inside the Stop pill's ⌄ menu, `🎙 Resume` after stop; date pill `DatePillModel.label` on the trailing edge opening the existing calendar popover with the attendee section appended ("Add attendees…" field + attendee list). Remove the bottom `recordingControlBar`; `recordingControlBar`'s timer moves to the Stop pill's `.help` and the menu bar item (Task 8).
- [ ] **Step 4: Run** `swift test` → PASS. Install, start a note, screenshot → `after-04-recording.jpg`, `after-04-finished-note.jpg`; stop and discard the test note.
- [ ] **Step 5: Commit** `desktop: Granola note header with segmented pill, Stop pill and trailing date (parity rank 3)`.

### Task 5: Transcript as an in-place tab with Granola runs (rank 4)

**Files:**
- Create: `UI/Notes/TranscriptRunGrouper.swift`, `UI/Notes/TranscriptTabView.swift`
- Modify: `UI/Notes/NoteWorkspaceView.swift` (replace `transcriptDrawer` with `TranscriptTabView` swapped into the body when the Transcript segment is active; Find + transcription-settings icon buttons replace the date pill in that mode), `Capture/LiveTranscriptEchoSuppressor.swift` (dedup window), `Capture/LiveTranscriptionCoordinator.swift` (apply suppressor to the display segments)
- Test: new `Tests/LoomDesktopTests/TranscriptRunGrouperTests.swift`, extend `LiveTranscriptEchoSuppressorTests.swift`

**Interfaces:**
- Produces: `TranscriptRunGrouper.runs(from bubbles: [TranscriptDisplayBubble], gapSeconds: Double = 8) -> [TranscriptRun]` where `TranscriptRun { id; speaker: String; speakerIndex: Int?; startSec: Double; paragraphs: [TranscriptParagraphLine] }`; `TranscriptDisplayBubble` becomes internal (not private) so the grouper can see it.

- [ ] **Step 1: Write the failing tests**:

```swift
func testRunsSplitOnSpeakerChange() {
    let runs = TranscriptRunGrouper.runs(from: [b("Me", 0, 3, "Hi"), b("Me", 3, 6, "there"), b("Call audio", 6, 9, "Hello")])
    XCTAssertEqual(runs.map(\.speaker), ["Me", "Call audio"])
    XCTAssertEqual(runs[0].paragraphs.map(\.text), ["Hi", "there"])
}
func testSingleSourceProducesOneRun() {
    XCTAssertEqual(TranscriptRunGrouper.runs(from: [b("Call audio", 0, 3, "a"), b("Call audio", 4, 7, "b")]).count, 1)
}
func testEchoWithinWindowIsDropped() {
    var s = LiveTranscriptEchoSuppressor(windowSeconds: 2.0)
    XCTAssertTrue(s.accept(text: "This is a parity audit test.", source: .systemAudio, at: 10.0))
    XCTAssertFalse(s.accept(text: "This is a parity audit test", source: .microphone, at: 10.3))
    XCTAssertTrue(s.accept(text: "Something else", source: .microphone, at: 10.6))
}
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** the grouper (merge consecutive bubbles with the same speaker when the gap is under `gapSeconds`), the suppressor's `accept(text:source:at:)` (normalised prefix match, 80% token overlap, inside the window, opposite source), and `TranscriptTabView`: gutter column 52pt with `Mono.body`-sized `h:mm` of `recordingStart + run.startSec` in `Text.tertiary`; speaker label `Body.md` medium coloured by `speakerIndex` from a 6-colour cycle (`Accent.ai`, #6EA8FE, #F2A65A, #E57BB2, #7DD3C0, #C4B5FD) with "Unknown speaker" / "You" fallbacks; paragraph bubbles `Bg.surface` 12pt radius, 16pt text, 8pt gap; "…" interim indicator; header right: `magnifyingglass` and `slider.horizontal.3` 32pt icon buttons (the second opens the existing Sources picker as a popover: language + microphone). Keep ⌘F search and the speaker label menus.
- [ ] **Step 4: Run** `swift test` → PASS. Install, record 30 s with `say`, screenshot → `after-05-live-transcript.jpg`, `after-05-finished-transcript.jpg`; trash the test note.
- [ ] **Step 5: Commit** `desktop: transcript tab with Granola runs, gutter timestamps and echo dedup (parity rank 4)`.

### Task 6: Recording chrome — hidden timer, home pill, menu bar timer (rank 7)

**Files:**
- Create: `UI/Home/RecordingInProgressPill.swift` ("••• New note ✕" at the top centre of the home content while `activeRecordingKind == .audio`)
- Modify: `UI/MainRecorderView.swift` (show the pill over `IdleHomeView`), `App/AppDelegate.swift` (menu bar item title shows the elapsed `mm:ss` while recording, via the existing status item)
- Test: `Tests/LoomDesktopTests/RecordingInProgressPillModelTests.swift` (title fallback "New note" when `audioTitle` is empty)

- [ ] **Step 1: Write the failing test**: `XCTAssertEqual(RecordingInProgressPillModel(title: "").label, "New note")`; `XCTAssertEqual(RecordingInProgressPillModel(title: "Standup").label, "Standup")`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement**: pill = three `Accent.ai` dots (opacity cycling 0.3→1, 1.2 s), title `Body.md`, `xmark` 12pt that calls `stopAudioNoteRecordingAndUpload()`; click elsewhere opens `noteTarget = .recording`. Menu bar status item title = `elapsedString` updated by a 1 s timer only while recording; tooltip "Loomola is recording".
- [ ] **Step 4: Run** `swift test` → PASS. Install, start a note, go home, screenshot → `after-06-home-while-recording.jpg`; discard the test note.
- [ ] **Step 5: Commit** `desktop: recording pill on home and menu bar timer, no in-window timer (parity rank 7)`.

### Task 7: Generate-notes moment (rank 6)

**Files:**
- Create: `UI/Notes/EnhanceTrigger.swift` (pure decision)
- Modify: `UI/Notes/NoteWorkspaceView.swift` (olive pill above the bottom bar, "Analyzing transcript" card, title-first reveal, feedback bar), `UI/RecorderViewModel.swift` (`stopAudioNoteRecordingAndUpload` persists the live transcript before `complete` and auto-starts enhancement when `EnhanceTrigger` says so), `src/app/api/notes/[id]/enhance/route.ts` (accept `source: "live"` so a `deepgram-live` transcript counts as ready for POST)
- Test: new `Tests/LoomDesktopTests/EnhanceTriggerTests.swift`; `tests/unit/notes-enhance-live.test.ts`

**Interfaces:**
- Produces: `EnhanceTrigger.decision(liveTranscriptChars: Int, batchReady: Bool) -> EnhanceDecision` (`.generateNow`, `.waitForBatch`, `.noTranscript`); server POST accepts `{ templateId?, source?: "live" | "batch" }`.

- [ ] **Step 1: Write the failing tests**:

```swift
func testTriggerDecisions() {
    XCTAssertEqual(EnhanceTrigger.decision(liveTranscriptChars: 0, batchReady: false), .noTranscript)
    XCTAssertEqual(EnhanceTrigger.decision(liveTranscriptChars: 120, batchReady: false), .generateNow)
    XCTAssertEqual(EnhanceTrigger.decision(liveTranscriptChars: 120, batchReady: true), .generateNow)
}
```
```ts
it("POST /enhance with source=live succeeds when only a live transcript exists", ...)  // mocks getAudioNoteEnhancementStatus with provider "deepgram-live"
```

- [ ] **Step 2: Run** both → FAIL. **Step 3: Implement**: on stop, persist the live snapshot (already uploaded by `persistLiveTranscript`; confirm the server stores it with provider `deepgram-live` and that `getTranscriptByRecording` returns it), then call enhance with `source: "live"`; the existing Stage-14 "Transcript updated → Regenerate" pill handles the batch re-run. UI: `✦ Generate notes` pill in `Accent.ai` with dark text, floating 12pt above the bottom bar, fades in place when pressed; title binding updates as soon as `titleSuggested` arrives (poll already returns it); "Analyzing transcript" card = 40pt `Bg.surface` rounded 12 with a small spinner and `Body.md`; after `.complete`, show "How do these notes feel? 👍 Good 👎 Not good ✕" bar (no backend; buttons log at `.notice` and dismiss).
- [ ] **Step 4: Run** `swift test` and `npm test -- notes-enhance-live` → PASS. Install, record 30 s with `say`, stop, screenshot the moment → `after-07-generating.jpg`, `after-07-feedback.jpg`; trash the test note.
- [ ] **Step 5: Commit** `desktop+server: generate notes from the live transcript immediately (parity rank 6)`.

### Task 8: Bottom bar with working chips (rank 8, reduced scope)

**Files:**
- Create: `UI/Notes/NoteBottomBar.swift`
- Modify: `UI/Notes/NoteWorkspaceView.swift`

- [ ] **Step 1: Implement** a bottom bar shaped like Granola's Ask bar (capsule, `Bg.surface`, 56pt, 1pt border) that holds chips with existing backends only: `Copy text`, `Open on web`, `Save to Obsidian`; no text input (single-note Q&A is a separate roadmap item). Hidden while recording.
- [ ] **Step 2: Build, install, screenshot** → `after-08-bottom-bar.jpg`.
- [ ] **Step 3: Commit** `desktop: Granola-shape bottom action bar with working chips (parity rank 8)`.

### Task 9: Top-right action cluster, Share, toasts (rank 9)

**Files:**
- Create: `UI/Notes/NoteActionCluster.swift`, `UI/Notes/SharePopover.swift`
- Modify: `UI/Notes/NoteWorkspaceView.swift` (`noteChromeBar`: always-visible `⋯`, `Add to folder`, `Share`, `Copy link` 28pt icon buttons on the trailing edge; folder and template pickers move here), `UI/Shell/Toast*` (new bottom-right toast with an optional Undo action; trash uses it with undo = `PATCH` restore if the API has it, else no undo button)
- Test: `Tests/LoomDesktopTests/SharePopoverModelTests.swift` (share link = `<apiBase>/notes/<slug>`)

- [ ] **Step 1: Write the failing test**: `XCTAssertEqual(SharePopoverModel(apiBase: URL(string: "https://x.test")!, slug: "abc").link.absoluteString, "https://x.test/notes/abc")`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement**: cluster at top-right (36pt spacing), `Share` popover 400pt wide: "People with access" row with the signed-in email as Owner, `Copy link` button; `⋯` menu keeps its current items restyled (28pt rows, red "Move to trash"); toasts bottom-right, dark `Bg.surfaceRaised`, 4 s, `Undo` when available.
- [ ] **Step 4: Run** `swift test` → PASS. Install, screenshot → `after-09-note-actions.jpg`, `after-09-share.jpg`.
- [ ] **Step 5: Commit** `desktop: always-visible note action cluster, Share popover and bottom-right toasts (parity rank 9)`.

### Task 10: Popovers and in-window settings (rank 10)

**Files:**
- Modify: `UI/Recent/FolderPickerPopover.swift` (note counts, "Show N more", green "New folder" row in `Accent.ai`, lock glyph on "My notes" row = unfiled), `UI/Notes/NoteWorkspaceView.swift` (date popover with attendees, already from Task 4), `UI/Shell/SettingsSheet.swift` → `UI/Shell/SettingsView.swift` rendered in the main window with a 180pt left tab list (General, Calendar, Notifications, Sources, Integrations, Account, Diagnostics) and `noteTarget`-style content swap; `UI/MainRecorderView.swift` (`showSettings` swaps content instead of presenting a sheet)
- Test: `Tests/LoomDesktopTests/FolderPickerCountsTests.swift` (`FolderPickerRows.build(folders:counts:limit: 3)` returns 3 rows + `.showMore(remaining: n)`)

- [ ] **Step 1: Write the failing test** for `FolderPickerRows.build`. **Step 2: Run** → FAIL. **Step 3: Implement** rows + views. **Step 4: Run** `swift test` → PASS. Install, screenshot → `after-10-folder-popover.jpg`, `after-10-settings.jpg`.
- [ ] **Step 5: Commit** `desktop: Granola folder popover and in-window settings (parity rank 10)`.

### Task 11: Light-mode check, full test run, branch hand-off

- [ ] **Step 1:** `swift test` → all green; `npm test` (root) → green.
- [ ] **Step 2:** Switch the app to light appearance (`defaults write cloud.dissonance.loom.desktop NSRequiresAquaSystemAppearance -bool true`, relaunch), screenshot home + note → `after-11-light-*.jpg`, fix any contrast fault, revert the default.
- [ ] **Step 3:** Update `CLAUDE.md` + `AGENTS.md` + `ROADMAP.md` with a Stage 21 entry (window size figures corrected, title bar description corrected, parity ranks shipped) and add the side-finding fix note for `RecentDateGrouping`.
- [ ] **Step 4:** Commit `docs: Stage 21 Granola pixel parity`; leave the branch unpushed for Ian to review and merge.
