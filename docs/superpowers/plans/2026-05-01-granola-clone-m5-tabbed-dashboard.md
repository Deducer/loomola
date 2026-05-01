# Granola-alt — Milestone 5: Tabbed Dashboard — Implementation Plan

**Goal:** Make `/` the shared Loom + Granola management surface without changing pure-Loom deploys. Recordings remains the default dashboard tab; Notes appears only when `ENABLE_GRANOLA=true`.

**What ships:**

- `/?tab=notes` shows an auth-gated Notes tab behind `ENABLE_GRANOLA=true`.
- Recordings tab explicitly filters `media_objects.type='video'`.
- Notes tab explicitly filters `media_objects.type='audio'`.
- Folder sidebar and mobile folder picker work for both tabs.
- Search is scoped to the active tab.
- Notes render as a chronological list grouped by day, with rows linking to `/notes/:slug`.
- Notes tab includes a `Quick note` action that creates a blank ready audio note and opens it.

**Out of scope for M5:**

- Calendar "Coming up" block.
- People/dictionary settings pages.
- Drag-select bulk actions for notes.
- AI enhancement controls.

## Tasks

- [x] Add dashboard tab parsing/link helpers.
- [x] Add type filtering to the dashboard search query.
- [x] Add Notes list UI grouped by date.
- [x] Wire `/` to Recordings/Notes tabs with shared folder/search state.
- [x] Add Quick note creation.
- [x] Add focused unit coverage.
- [x] Run typecheck, targeted tests, and browser smoke.

## Verification

- `ENABLE_GRANOLA=false` hides Notes UI and treats `?tab=notes` as Recordings via `getDashboardTab`.
- `/?tab=notes` shows Ian's uploaded audio note `ZTrwDqeOop`.
- `/` keeps the existing recordings grid for video rows.
- Searching/folder filtering scopes to the active tab.

## Commands Run

- `npm run typecheck`
- `doppler run --project dissonance-cloud --config prd_loom -- npm run test -- notes-queries dashboard-tabs note-day-label note-identifiers`
- Authenticated Playwright smoke against `http://localhost:3000/` and `http://localhost:3000/?tab=notes`
