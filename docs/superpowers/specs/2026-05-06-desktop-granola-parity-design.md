# Desktop Granola-shape UI parity

**Author:** Claude Opus 4.7
**Date:** 2026-05-06
**Status:** Pass 1 shipped (rows + bulk + folder picker + sidebar). Pass 2 + 3 specced for follow-up.
**Driving feedback:** Ian, 2026-05-06 — *"Let's get it looking like that first"* (with annotated Granola screenshots).

---

## Pass 1 — Shipped 2026-05-06 (`<commit pending>`)

The high-impact list-and-row-level Granola moves. Everything user-visible from a quick sidewise glance at Granola.

### Recent notes row

- **Hover checkbox** on the left for bulk select; visible on row hover, persistent while any row is selected.
- **Always-visible folder pill** (was hover-only). Subtle tray glyph + no label when unfiled, folder icon + name when filed. Chevron only on hover (Granola behavior).
- **Hover ⋯ menu** on the far right with `Move to folder` (re-opens folder picker) and `Delete` (with confirmation alert).
- **Hover bg highlight** on the row.
- **Click target split** — icon + title region opens the note; pill, ⋯, and checkbox each own their own clicks.

### Folder picker popover

- **Search field at top** with autofocus (matches Granola's keyboard-first feel).
- **Inline `+ New folder "<query>"`** at the bottom in the accent green when the query doesn't match any existing folder. Creating a folder auto-assigns the recording to it and dismisses.
- **Lock-icon variant for current selection** (checkmark) preserved.
- **Keyboard:** picker opens with the search focused; X clears the query.

### Bulk selection bar

- Floating action bar appears at the bottom of the strip while any rows are selected.
- `N selected · Move · Delete · ✕`. Move re-uses the folder picker (with create flow). Delete has a confirm alert. ✕ clears selection.

### Sidebar overlay

- Toggle: title-bar icon (left of the wordmark) + `⌘S` keyboard shortcut.
- 280pt wide, slides in from the left with a dimmed content layer behind it (click to close).
- Sections:
  - **Search** field with `⌘K` chip (cosmetic for now — query state wired but the actual search-against-recordings is part of the deferred Spaces filter work).
  - **Home** — clears any folder filter.
  - **Spaces** — alphabetical folder list. Click a folder → strip filters to that folder, sidebar closes, strip header shows the folder name with an ✕ to clear back to Home.

### Visual polish

- Per-row dividers removed (was: subtle line between rows). Granola has no dividers in its row list.
- Folder pill at rest is borderless; only the hover state shows a subtle surface bg.
- Added a `DSColor.State.danger` token (#D83838 light / #F66767 dark) for destructive actions; the recording-red `State.recording` stays distinct so a refactor of either doesn't drag the other along.

---

## Pass 2 — Deferred (folder customization)

Granola's folder rows in the sidebar can have custom emoji/icon glyphs and brand colors (the orange chip on "Ai Advantage Bootcamp", the purple "N" diamond on "Rian Doris", etc.). Two schema columns close most of this:

```sql
ALTER TABLE folders
  ADD COLUMN icon          text,    -- emoji ("🎯") OR SF Symbol name ("folder.fill") OR null
  ADD COLUMN color_hex     text;    -- "#7C3AED" OR null (defaults to neutral folder fg)
```

UX:
- Folder edit modal on the web dashboard gets an icon picker (recent emoji + SF Symbols + paste a hex).
- Folder rows everywhere (sidebar, picker, pill) render the icon when set, else fall back to `folder` SF Symbol.
- Color tints the icon foreground (subtle — keep readability).

Effort: ~half day.

## Pass 3 — Deferred (Favorites + bottom rail)

Granola pins certain folders to a "Favorites" section above Spaces. Add:

```sql
ALTER TABLE folders
  ADD COLUMN is_favorite        boolean NOT NULL DEFAULT false,
  ADD COLUMN favorite_sort_order integer;
```

UX:
- Right-click on a sidebar folder row → "Pin to Favorites".
- Drag-reorder within Favorites (sets `favorite_sort_order`).
- Favorites section renders above Spaces, separated by a divider.

Effort: ~half day.

## Pass 4 — Deferred (Coming up calendar surface)

Granola's home view starts with an upcoming-events panel above the recent-notes list. Already specced separately as a desktop feature in ROADMAP "Calendar-aware pre-meeting prompt". Implementation:

- EventKit integration with a permission preflight.
- `Home/ComingUpSection.swift` rendering today + tomorrow's events as compact cards.
- N-min-before notification with Start audio note / Open meeting actions (already present on the existing meeting prompt).

Effort: ~half day after EventKit permission UX.

## Pass 5 — Deferred (multi-workspace + Shared with me)

The "Vayu Labs ⇄" workspace switcher and "Shared with me" / "Chat" sidebar items are multi-tenant features. Out of scope until team accounts ship. The schema for that is also out of scope here — see CLAUDE.md "Out-of-Stage-1 Scope" / multi-tenant.

---

## Non-goals (explicit)

- **Don't replicate Granola's wordmark serif.** Loomola has its own brand voice (Inter for the wordmark). Match Granola's *structural* patterns, not their typography.
- **Don't ship the bottom rail icons** (people / companies / trash). Each is a separate product slice (people admin UI, contact-CRM-style company surface, soft-delete trash). They warrant their own designs, not stubs.
- **Don't auto-favorite anything.** Favorites is user-driven; never inferred from frequency.

---

## Open questions

- **Sidebar collapse on small windows.** When the window is < ~900pt wide, the sidebar overlay covers most of the content. Should it instead push content right at small sizes, or stay overlay always? Granola pushes; macOS NSSplitView default is push. Probably push when it lands.
- **Multi-folder pill layout.** When Phase 2 of the multi-folder migration ships and a note can be in multiple folders, the pill needs to handle "+N more" or two-pill-stack. Defer this UX call to that ship.
- **Inline edit on the folder pill.** Granola lets you start typing right after clicking a folder pill — no popover, just inline rename / re-file. Probably worth in pass 2 alongside folder customization.
