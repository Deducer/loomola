# Granola pixel-parity audit: Loomola desktop meeting-recording surfaces

**Date:** 2026-10-28
**Status:** Phase 2 built 2026-10-28 on `feat/granola-pixel-parity` (all ten ranks, one commit each; see ROADMAP.md Stage 21). Awaiting Ian's merge.
**Compared builds:** Granola 7.700.0 (Electron 44, dark appearance) vs Loomola desktop built from `main` at `4026c12` (installed via `desktop/scripts/install-local-app.sh`), same Mac, same dark system appearance, windows sized 1200×769 (Granola) and 1190×763 (Loomola).
**Evidence:** `docs/Granola UI Screenshots/2026-10-28-parity/` — 35 raw captures (`granola-*.jpg`, `loomola-*.jpg`) plus 8 side-by-side composites (`pair-*.jpg`, Granola left, Loomola right). The May 2026 settings/templates captures in the parent folder are reused for settings.
**Source inventory of the current Loomola implementation** (fonts, tokens, paddings, copy per surface): shared notes folder, `loomola-desktop-visual-inventory.md`. Read it before Phase 2; it corrects two stale CLAUDE.md claims (window default is 1240×820 / min 1100×700, and the title bar is a SwiftUI overlay, not `ToolbarItem`s).

## How to read this

Severity classes (each row carries one or more):

- **L** layout / structure: things are in a different place, missing, or built from a different component.
- **T** typography and spacing: face, size, weight, line height, paddings.
- **C** colour and iconography: palette, accents, glyphs.
- **B** behaviour and timing: what happens on click, what animates, what appears when.

"Match" means it already looks and behaves like Granola closely enough that a side-by-side glance would not flag it.

Three constraints shape every recommendation:

1. Loomola is two products in one window (Loom-style video plus Granola-style notes). The video entry point has to survive; Granola has no equivalent.
2. Granola's title serif ("QuadrantNotepad") and body grotesk ("MelangeGrotesk") are proprietary. Pixel-matching the type means picking open look-alikes, not copying the faces.
3. Loomola's desktop is native SwiftUI/AppKit. Where Granola's Electron UI breaks a macOS convention (grey inactive traffic lights, in-content toolbar), I say whether matching it is worth it.

## Reference check: github.com/morluto/rea

**What it is:** "REA: Reverse Engineer Anything", an MIT-licensed MCP server plus CLI (`npx rea-agents setup`) that gives a coding agent tools to inspect native binaries (via Hopper/Ghidra/IDA), Electron and JavaScript bundles, .NET assemblies and websites, with evidence-backed reports. It is a reverse-engineering toolkit, not a Granola re-implementation and not a design reference.

**Is anything reusable?** Only as a way to read Granola's shipped CSS: Granola is Electron, so its exact font sizes, colours, paddings and animation durations sit in `/Applications/Granola.app/Contents/Resources/app.asar`, and REA (or a plain `asar extract`) would read them. That would turn this audit's measured approximations into exact numbers. I did not do it: it means unpacking a third-party app's bundle, which Granola's terms very likely prohibit, and the visual gaps below are large enough that measured screenshots already decide the work. If Ian wants exact tokens for the final polish pass, that is a separate, explicit decision.

## Screen-by-screen gap table

### 1. Home / recent list (`pair-01-home.jpg`, `granola-01*.jpg`, `loomola-01-home-audio-tab.jpg`)

| Element | Granola | Loomola | Gap |
|---|---|---|---|
| Overall shell | Persistent 192pt left sidebar (Home, Shared with me, Chat; Favorites; Spaces with lock/team icons; footer icons; plan badge; workspace switcher). Content column centred, ~620pt wide. | No sidebar by default (⌘S slides a 280pt one in and pushes content). Wordmark + gear + avatar in the title bar. Content left-aligned in a 1080pt column. | **L** major |
| Entry point | Top-right `Invite` and `+ New note` pill buttons; search and sidebar-toggle icon buttons top-left. | A 14pt-radius hero card with a Video / Audio note segmented control, a blue `Start audio note` button with a brand shadow, Mic / System audio checkboxes, a Ready pill and a Microphone field. Video tab is the default on launch. | **L** major, **C** |
| Calendar | "Coming up" serif heading over a card: big serif day numeral, month/weekday stacked, purple 2pt event bar, event title + time range, chevrons to page days, filter icon. | None on desktop home. (Calendar data exists: Today pill, reminders, attendees.) | **L** major |
| List heading | None; groups start straight after the calendar card. | "Recent notes" in Inter 24 semibold. | **T** |
| Group headers | "Today", "Yesterday", "Mon, Oct 26" in ~12pt grey, left-aligned with the rows. | Same labels, `Body.sm` tertiary, indented 12pt. | Match |
| Row | 48pt: 32pt rounded doc icon, title (1 line, ellipsis), **attendee subtitle "Me"** under the title, right side: inline **"Add to ▸ Folder ✓ ✕" suggestion pill** when unfiled, time in small caps "9:44 AM", folder icon when filed. No dividers. | 52pt: same icon, title only, folder pill with name (tray glyph when unfiled), time "1:33 PM" with capital AM/PM, hover checkbox and ⋯. No subtitle, no inline suggestion (suggestion lives inside the note as a banner). | **L**, **T** |
| Bottom bar | Floating "Ask anything" input with a "List recent todos" chip, always visible. | None. | **L** (needs backend, see rank 8) |
| Search | ⌘K palette: "Search people, folders, companies, or meetings", New note row with ⇧⌘N, Companies, Folders sections. | Sidebar search field; results inline in the sidebar. | **L**, **B** |
| Recording indicator on home | Floating "••• New note ✕" pill at the top centre of the content while a note records (green animated dots); clicking it reopens the note. | Floating system-wide pill (36×88 capsule, excluded from screen capture) and nothing inside the home view since `RecordingStatusPill` was removed. | **L**, **B** |

### 2. Meeting detected / start moment

| Element | Granola | Loomola | Gap |
|---|---|---|---|
| Start | `+ New note` creates the note and starts capturing immediately; no consent prompt, no readiness check visible. Menu bar gets the macOS orange mic capsule. | `Start audio note` shows a "Checking" readiness spinner in the pill for ~1 s, then swaps the hero for the workspace. | **B** minor |
| Meeting prompt | Not exercised (no call was running). Granola shows a top-right notification card when a meeting app is detected (from its docs). | Hard-coded dark 406×76 card at top-right with a cyan accent bar, "Join Meeting / & open Loomola" group, chevron menu, hover close. | Not compared; keep. |

### 3. Live recording (`pair-03-recording.jpg`, `granola-03*.jpg`, `loomola-03-recording-workspace.jpg`)

| Element | Granola | Loomola | Gap |
|---|---|---|---|
| Title | "New note" placeholder in the title serif, ~30pt, dim grey (#8e8e8c on #252525). Editable. | "New note" placeholder in system New York serif, 30pt medium, tertiary grey. | **T** minor (face, weight) |
| Header row | One row under the title: a dark segmented pill `[📄 My notes │ ⋯]` (inactive tab shows as an icon only), a white-square `■ Stop` pill, and `📅 Today` at the far right. Nothing else. | Four outlined pills in a row: Today, Me, Add to folder, General meeting (template). No stop control here. | **L** major |
| Recording controls | `■ Stop` in the header. No timer, no level meter, no red dot anywhere in the window. | Bottom-centre 44pt capsule: 5-bar blue meter + chevron │ `00:13` JetBrains Mono │ red pause glyph. Paused state adds a green Resume and a ✓ (end & upload). | **L**, **C** |
| Editor placeholder | "Write notes, or press '/' for templates" | "Write notes" | **T** copy |
| Slash menu | `/` opens a block/template menu (Heading, Bullet List, Checkbox, then templates). Not captured (needs a real keystroke); confirmed via accessibility tree. | Template picker is a pill popover (list 220 + detail 340). No slash command. | **B** |
| Bottom bar | "Ask anything" input, always visible, even while recording. | Recording control bar. | **L** |
| Window chrome | Back/home pill top-left; `⋯` and `Add to folder` icon buttons top-right. Traffic lights rendered grey. | Back/home pill top-left (match); ⋯ ghost button appears only on hover. | **B** minor |

### 4. Live transcript (`pair-04-live-transcript.jpg`)

| Element | Granola | Loomola | Gap |
|---|---|---|---|
| Where it lives | A **tab** in the header segmented pill: `[📄 │ ••• Transcript]` with three green pulsing dots; the body is replaced in place. Right side swaps Today for `Find` and `Transcription settings` icon buttons. | A **drawer** card (20pt radius, raised, max 720pt) that slides up over the editor from the bottom, with a header row (search, title "Live transcript", word count, jump/copy/hide icons). | **L** major |
| Line layout | Timestamp gutter ("12:24") left of the first bubble; "Unknown speaker" / speaker name label above a run; all bubbles left-aligned, flat #2f2f2f, 12pt radius, 16pt text; "…" typing indicator while interim. | Chat layout: "Call audio" bubbles left, "Me" bubbles right-aligned; 13pt text; speaker label 12pt above each bubble; no timestamps. | **L**, **T** |
| Speaker colours | Per-speaker label colour (You = lime, Gabe Masi = blue) on the finished transcript. | Grey labels; accent only on unnamed "Speaker N". | **C** |
| Echo | One stream of speech. | The spoken test audio appeared twice: once as "Call audio", again truncated as "Me" (mic heard the speaker). Server-side dedup exists for the batch mix; the live view does not dedup. | **B** |
| Transcription settings | Popover: Language (English best quality / Multi-language), Microphone level meter + device list, Sound settings, Troubleshoot, Report transcript issue. | Settings sheet → Sources + Preferences (language pickers). Nothing in the note. | **L** |

### 5. Pause / stop / enhance (`pair-05-stopped.jpg`, `pair-06-enhancing.jpg`, `granola-07*.jpg`, `granola-08*.jpg`, `loomola-05*.jpg`, `loomola-06a/b*.jpg`)

| Element | Granola | Loomola | Gap |
|---|---|---|---|
| Pause | No pause. Stop is final; `🎙 Resume` appears in the header afterwards and resumes the same note. | Pause/Resume in the control bar; ✓ ends. | **B** (Granola's model is simpler; keep Loomola's pause but relabel, see rank 3) |
| After stop | Header: `[My notes │ ‖‖]`, `🎙 Resume`, Today. An **olive-green `✦ Generate notes` pill** floats just above the Ask bar; the Ask bar gains a `Write follow up email` chip; `Share` and `Copy link` appear top-right. | Pills unchanged; bottom row: `Transcript ⌃` + mint-green (#34d399) `✦ Generate notes`. Upload runs first (finalizing view flashes for under a second). | **C**, **L** |
| Generating | Title is written immediately in the serif; pill becomes `✦ Enhanced ⌄`; body shows "Add your thoughts…" placeholder and an **"Analyzing transcript" progress card** with a spinner; the green pill fades out in place. Whole thing ~8 s for a 30 s note. | `Generate notes` turns into `🕓 Waiting for transcript` (batch transcript not ready yet); then "Writing notes" bar; title and body arrive together when the job finishes. Minutes, not seconds, because batch transcription runs first. | **B** major, **L** |
| Feedback | "How do these notes feel? 👍 Good 👎 Not good ✕" bar slides in above the Ask bar after generation. | None. | **L** minor |

### 6. Finished note (`pair-07-finished-note.jpg`, `pair-09-finished-transcript.jpg`)

| Element | Granola | Loomola | Gap |
|---|---|---|---|
| Header row | `[✦ Enhanced ⌄ │ ‖‖]` segmented pill, `🎙 Resume`, date pill right ("Today" / "Yesterday"). Attendees and folder are **not** in the header: attendees live in the date popover, folder in the top-right icon. | `✦ Enhanced` toggle pill, Today, Me, Vayu Labs, General meeting — five pills in a row. | **L** major |
| Title | Serif, ~30pt, regular weight, near-white, 1.15 line height; wraps to two lines at 640pt. | New York 30pt medium, wraps at 760pt. | **T** |
| Body | Grotesk ~16pt, ~1.6 line height, grey #c8c8c6 on #252525. Headings rendered with a faint `#` marker in the left gutter; bullets `•` and hollow `○` for nested; generous 20pt paragraph gaps. | SF 16pt, line spacing 5.5, text #9e9c93 on #0e0f12. Headings as bold text, no gutter marker; bullets drawn manually. | **T**, **C** |
| Transcript | Same in-place tab as live; per-block timestamps in the gutter; speaker name above runs, coloured; selectable section checkboxes. | Drawer; "Ian Cross: …" inlined in the bubble text; no timestamps. | **L**, **T** |
| Actions | `⋯` menu: Copy transcript, Send notes via email, Send to Slack (#channel), Send to Zapier, Save to Notion, Save to HubSpot, Move to trash (red). `Add to folder` popover: search, My notes (lock) with ✓, folders with note counts, "Show 12 more", team space, green "New folder". `Share` popover: name/email/folder field, people with access, domain picker, Copy link. | `⋯` popover (300pt): Copy text, Open on web, three downloads, Apply dictionary & regenerate, Save to Obsidian, Move to trash. Folder picker: search, list, inline new folder. No Share. | **L**, **B** (Share needs the web share link, which exists) |
| Bottom | "Ask anything" + "Write follow up email"; "Granola uses AI and can make mistakes." footer. | `Transcript ⌃` + `Regenerate notes` pills. | **L** |
| Toasts | Bottom-right dark toast "Note moved to trash · Undo". | Bottom-centre capsule toast, auto-dismiss 2.5 s, no undo. | **C**, **B** minor |

### 7. Settings touching recording (`pair-08-settings.jpg`, May captures 01–10)

| Element | Granola | Loomola | Gap |
|---|---|---|---|
| Container | In-window settings page with a left tab list (Preferences, Labs, Profile, Calendar, Notifications, Connectors, Workspace, Billing, Templates). | Separate 580×620 sheet window, single scroll, section headings in Inter 24. | **L** |
| Recording-relevant rows | Meeting indicator, meeting window behaviour, transcript retention, transcription + summary language, internal jargon, auto-detect call toggle, calendar visibility, meeting notifications. | Meeting detection, live recording indicator, live transcription, calendar attendees, transcription/summary language, reminders. Functional parity is good (shipped in May/July). | **T**, **C** only |

### 8. Global look

| Element | Granola | Loomola | Gap |
|---|---|---|---|
| Palette (dark) | Canvas #252525, sidebar #1e1e1e, raised surfaces #2f2f2f, text #c8c8c6 / #8e8e8c, accent lime (#b2c248 family, from Granola's own docs CSS), purple for calendar bars and the workspace mark. Warm, low-contrast. | Canvas #0e0f12, surface #181a20, raised #1f222a, text #f4f4f1 / #9da0ac, accent blue #5c9bff, success mint #34d399, recording red. Cool, higher contrast. | **C** major |
| Palette (light) | #F2F2EC background family (docs: `--oats-*` lime greens). | #FAFAF7 canvas, white cards. | **C** |
| Type | Serif display + geometric grotesk body. | New York (system) title + Inter UI + SF body. | **T** |
| Radii | Pills everywhere (9999); cards 12–16pt. | Same scale (`DSRadius`). | Match |
| Theme switch | In settings (System/Light/Dark). | Follows macOS only. | **B** minor |

## Side findings (not visual, but found during the audit)

- **Loomola hung at 100% CPU for 5+ minutes** after I pressed the home button while a note was recording. `sample` shows the main thread looping in `RecentStrip.body` → `RecentDateGrouping.grouped` → a new `DateFormatter` per row per render (`desktop/Sources/LoomDesktopApp/UI/Recent/RecentDateGrouping.swift:80`). Every 1 s timer tick re-renders the home view, and each render re-groups and re-formats the whole list; with the active-recording card on screen that becomes a render storm. Fix: cache the three formatters (static lets) and memoise the grouped result keyed on the item ids. Half a day with a test. I force-quit and relaunched the app; the half-finished test recording went to trash via the API.
- Live transcript echo (section 4) is a behaviour gap, not a pixel one, but it is the first thing you see when you open the drawer.
- The `Today` pill on a note recorded yesterday says "Today" in Loomola (`loomola-06-finished-note-enhanced.jpg`); Granola says "Yesterday". The label is computed from the wrong date or never recomputed.

## Top 10 changes ranked by visual impact

Impact = how much of the screen changes × how often Ian looks at it. Effort is a rough Phase 2 estimate on the native app.

| # | Change | Classes | Why it ranks here | Effort |
|---|---|---|---|---|
| 1 | **Adopt Granola's neutral palette and lime accent.** Re-point `DSColor` dark values to the warm charcoal scale (#1e1e1e / #252525 / #2f2f2f, text #c8c8c6 / #8e8e8c) and light values to the #F2F2EC family; make AI actions (Generate notes, Enhanced) lime instead of mint; keep blue only for the video product. | C | Every screenshot pair reads as "different app" before any layout detail registers. One token file. | 0.5 day + a visual pass on contrast |
| 2 | **Home: persistent sidebar + Coming up + Granola row.** Sidebar visible by default on the notes side (Home, Favorites, Spaces; search at top), "Coming up" card from the existing EventKit data, rows with the attendee subtitle and inline Add-to-folder ✓ ✕ pill, `+ New note` top-right. The Video product keeps its hero card on the Video tab only. | L | Largest structural gap and the screen Ian lands on. The data for every piece already exists on desktop. | 2 days |
| 3 | **Note header: one segmented pill + Stop/Resume, date pill right.** Replace the five-pill row with `[My notes │ Transcript]` (Enhanced replaces My notes once notes exist), a `■ Stop` / `🎙 Resume` pill, and the date pill at the right edge. Attendees move into the date popover; folder and template move to the top-right icon cluster. Pause stays, as a secondary item in the Stop pill's menu. | L, B | The header is on screen for every minute of every meeting and is the most recognisable Granola shape. | 1.5 days |
| 4 | **Transcript as an in-place tab, Granola line layout.** Retire the bottom drawer. Timestamp gutter, speaker label above runs, all bubbles left-aligned in #2f2f2f, per-speaker label colour, Find and transcription-settings icons on the right. Dedup the live mic echo. | L, T, B | Second most-used surface during a call; the drawer-over-editor is the clearest "not Granola" moment. | 2 days (1 of it on the echo) |
| 5 | **Typography pass.** Bundle an open serif close to Granola's (Newsreader or Fraunces, regular weight) for the title, size it 30pt/1.15; body 16pt/1.6 in Inter with Granola's grey; heading gutter `#` marker; bullet/paragraph spacing. | T | Changes how every note reads. Push-back: do not chase their proprietary faces; an open serif at the same metrics gets 90% of the look. | 1 day |
| 6 | **Generate-notes moment.** Olive pill floating above the bottom bar, immediate title from the live transcript, "Analyzing transcript" progress card, pill fades in place, feedback bar after. Behind it: run enhancement on the live transcript immediately and re-run when the batch transcript lands (the Stage 14 "transcript updated" pill already handles the second run). | B, L, C | Granola's result appears in seconds; Loomola's in minutes. The waiting-for-transcript pill is the most felt gap after a call. | 1.5 days (0.5 server) |
| 7 | **Recording chrome.** Remove the bottom control bar; Stop in the header (rank 3); green pulsing dots on the Transcript tab; "••• New note ✕" pill at the top of home while recording. Keep the timer, but in the Stop pill's hover tooltip and the menu bar item, not in the editor. | L, C | Removes the one element Granola deliberately does not show. Push-back: Ian may want the timer visible; make it a setting. | 0.5 day |
| 8 | **Bottom "Ask anything" bar.** Only once single-note Q&A exists (roadmap item, ~2–3 days server). Until then do not ship a dead input; ship the bar with the follow-up chips that already have backends (Copy text, Open on web, Save to Obsidian) or skip. | L | Big visual element, but a fake one is worse than none. | 1 day UI after Q&A ships |
| 9 | **Top-right action cluster + Share.** Always-visible `⋯`, `Add to folder`, `Share`, `Copy link` on notes; Share popover backed by the existing web share link; grey-on-dark icon buttons. Toasts bottom-right with Undo for trash. | L, B | Small area, but it is where every post-meeting action starts. | 1 day |
| 10 | **Popovers and settings container.** Granola-shape folder popover (counts, Show more, green New folder), date popover with attendees, ⋯ menu styling; settings as an in-window page with a left tab list instead of a separate sheet. | L, C | Finishing layer; low per-screen impact but many screens. | 1.5 days |

Not on the list on purpose: workspace switcher, Shared with me, Chat, Invite, plan badge (multi-tenant features, out of scope per `AGENTS.md`); grey inactive traffic lights (Electron artefact, a native app should not copy it); Slack/Notion/HubSpot menu items (no backend, no plan).

## What Phase 2 needs from Ian

1. OK on the ranked list, or a re-ordered subset.
2. Decision on rank 7's timer: hidden like Granola, or a setting.
3. Decision on rank 5's serif: Newsreader (closest), Fraunces, or keep New York.
4. Whether to read Granola's bundle for exact tokens (see the REA section). Default: no.

Phase 2 plan, once approved: feature branch `feat/granola-pixel-parity`, one commit per rank, each re-screenshotted against the matching `granola-*.jpg` and added to the parity folder as `after-NN-*.jpg`, unit tests green (`swift test` in `desktop/`), web app and backend untouched except the rank 6 enhancement trigger.
