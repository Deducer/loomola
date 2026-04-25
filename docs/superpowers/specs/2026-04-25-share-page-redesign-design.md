# Stage 1.6 — Share page redesign + creator console

**Milestone:** Stage 1.6 (post-Stage-1.5 UX polish)
**Goal:** Make `/v/:slug` feel zen and curated rather than messy. Split creator-only controls onto a dedicated `/recordings/[id]/edit` console so the share page is purely a viewer surface for everyone — owner included.
**Companion to:** [`2026-04-22-loom-clone-design.md`](./2026-04-22-loom-clone-design.md), [`2026-04-24-loom-clone-stage-1-5-premium-ux-design.md`](./2026-04-24-loom-clone-stage-1-5-premium-ux-design.md). Closes the four "Stage 1.5 polish follow-ups" listed in [`ROADMAP.md`](../../../ROADMAP.md#stage-15-polish-follow-ups-candidate-for-stage-16) (move creator controls, redesign drop-off chart, declutter share page, Loom-style trim handles is partially in scope as Loom-style chapter segments instead).

---

## Goal in one paragraph

Today `/v/:slug` stacks ~10 sections vertically (player → tracking → transcript → chapters → action items → comments, plus owner-only password / trim / downloads / drop-off chart / share URL). The page tries to be both a public viewer and a creator console at once. This redesign separates those two products: `/v/:slug` becomes watch-first with progressive disclosure, and creator controls move to a new `/recordings/[id]/edit` console. Chapters are visualized as Loom-style colored segments on the player's seekbar instead of a markers-only list, eliminating one whole below-fold section.

---

## Scope

**In scope:**

- Redesign `/v/:slug` as a watch-first surface with theater-style player and tabs for deep content (Transcript, Comments).
- Custom Loom-style chapter segments overlay on Plyr's progress bar (replaces current point-marker chapters).
- Refactor `ViewerShell` from a flat stack into: title → player (with chapter segments) → AI summary → action items (hidden if empty) → chapters list → tabs (Transcript · Comments).
- New page `/recordings/[id]/edit` (sticky-preview two-column) housing all creator controls.
- Move out of `/v/:slug`: `OwnerToolbar` (password / trim / downloads), `DropoffChart`, view count, share URL + copy button, status-not-ready creator messaging.
- Owner affordance on `/v/:slug`: a small "Edit" pill in the brand header (owner-only). Dashboard card menu also gains an "Edit" link.
- Redesigned drop-off chart (smooth filled area, not 10 hard bars). Lives on the edit console.
- Inline title rename on the edit console.
- Brand reassignment (existing brand picker) on the edit console.
- Delete recording on the edit console (uses the existing soft-delete endpoint from Stage 1.5b).
- Empty-state polish for the new sections (no chapters, no action items, no comments, transcript still processing).

**Out of scope (explicit):**

- Emoji reactions on videos. Listed in Stage-1 scope-fence; deferred.
- Loom-style inline trim *handles on the seekbar* (replacing the two-range slider in the trim editor). Different problem from chapter segments. Defer until the trim UX rebuild later.
- Brand profile Layers 2–5. Already deferred.
- Re-encoded trim downloads. Same.
- Mobile-specific layout overhaul. Pages remain responsive (single-column collapse below ~768px), but the design lane targets desktop.
- AI Q&A chat, viewer-side reactions, outbound webhooks — all deferred.

---

## Architecture

### `/v/:slug` — visitor surface

The page is the same for owner and visitor, with one exception: an "Edit" pill in the brand header for owners. No other owner-conditional rendering.

**Vertical structure (top to bottom):**

```
BrandHeader  (logo, brand name, accent strip, optional Edit pill)
├── Title (h1, generous breathing room)
├── Player
│   ├── <video> + Plyr instance
│   └── ChapterSegmentsOverlay  (custom DOM painted on top of .plyr__progress)
├── SummaryBlock          (AI summary as a calm caption; max-width 75ch)
├── ActionItemsBlock      (rendered iff actionItems.length > 0)
├── ChaptersList          (timestamp + title rows; rendered iff chapters.length > 0)
└── ContentTabs           (Transcript · Comments)
```

The `<Tracking>` component (anonymous view tracking) keeps its current behavior — non-owner only, runs in the background, no UI.

**Component changes:**

- **New `ChapterSegmentsOverlay`** (`src/components/viewer/chapter-segments.tsx`)
  - Pure CSS-overlay component. Takes `chapters: Chapter[]`, `durationSec: number`, and a ref to the Plyr `.plyr__progress` element.
  - Renders one absolutely positioned `<button>` per chapter, sized by `(end - start) / total * 100%`, with `left` based on `start / total * 100%`. Each button has a hover label and a click-to-seek handler.
  - Visual: thin gap between segments (1–2px), played portion shows accent color, unplayed shows muted bg, current chapter has a brighter outline.
  - Plyr keeps its native progress bar underneath — segments are decorative + interactive overlays, not a replacement for the seek mechanic.
  - Mounts after Plyr's `ready` event (the progress element doesn't exist before then). Listens for window resize to keep widths in sync. Cleans up on unmount.
- **New `ContentTabs`** (`src/components/viewer/content-tabs.tsx`)
  - Two-tab strip: Transcript · Comments. Default: Transcript open.
  - URL-driven via `?tab=transcript|comments` (default: transcript). `replaceState` on click so deep-linking and back-button behave naturally.
  - Each tab's panel is rendered (not just hidden) only when active — keeps the Plyr / transcript-scroll wiring simple.
- **New `SummaryBlock`** (`src/components/viewer/summary-block.tsx`)
  - Takes the AI summary text. If null/empty, renders nothing.
  - Calm typography: 15–16px, 1.65 line height, max-width 75ch, muted-not-loud color.
- **New `ActionItemsBlock`** (`src/components/viewer/action-items-block.tsx`)
  - Replaces `ActionItemsList` for the visitor surface. Renders nothing if empty. Same click-to-seek behavior on each item.
- **`ChaptersList`** (`src/components/viewer/chapters-list.tsx`)
  - Already exists. Visual pass: timestamp column (mono, accent color) + title column. Same click-to-seek. Renders nothing if `chapters.length === 0`.
- **`TranscriptPanel`** (`src/components/viewer/transcript-panel.tsx`)
  - Already exists with paragraph-synced auto-scroll + click-to-seek. Continues to work as the Transcript tab's content. The auto-scroll container needs to remain mounted while the tab is active (handled by ContentTabs not unmounting its active panel).
- **`CommentsSection`** (`src/components/viewer/comments-section.tsx`)
  - Already exists. Becomes the Comments tab's content. No behavioral change.
- **Removed from `/v/:slug`:** `OwnerToolbar`, `DropoffChart`, share-URL block, view-count meta line, status-not-ready section copy ("AI outputs generating") — all moved to the edit console. (Status-not-ready visitor messaging stays as a calm "This recording is still being prepared. Check back in a minute." block — visitors get one-line context, not pipeline detail.)
- **`viewer-shell.tsx`** is rewritten to compose the new structure.
- **`page.tsx`** (the share page) is simplified: drop owner-conditional branches for downloads, drop-off, share URL, view count.

**BrandHeader Edit pill:**

- Owner only. Right-aligned alongside the existing "Dashboard" link. Goes to `/recordings/[id]/edit` (using the recording's UUID — slug stays for public).
- Visual: subtle ghost-style pill, lucide `Pencil` icon + "Edit" label.

**Player accent override:**

- Brand accent (when present) drives `--plyr-color-main` for played-portion of progress, AND drives the segment overlay's "played" color via a CSS variable on the wrapper. Single source of truth.

### `/recordings/[id]/edit` — creator console

New route. Authenticated; redirects to `/login?next=/recordings/[id]/edit` if not signed in. Returns 404 if the recording exists but the requester isn't the owner (no leak that the recording exists).

**Layout (sticky-preview two-column on desktop):**

```
EditHeader  (full-width)
├── Inline-editable title  (saves on blur or Enter)
├── Status badge  (ready / processing / failed / uploading)
├── "View public page" link (→ /v/:slug, opens in new tab)
└── Share URL + copy button

Main grid (2-col on ≥1024px, single column below)
├── LEFT (sticky, ~40% width)
│   └── Preview player (small Plyr instance, same signed URL flow as share page)
│   └── Quick stats card (view count, duration, created date)
└── RIGHT (scrolls)
    ├── Settings section
    │   ├── Brand picker
    │   └── Password (set / change / clear, bcrypt round-trip via existing API)
    ├── Trim section
    │   └── Existing two-range trim editor, lifted as-is
    ├── Downloads section
    │   └── Per-track signed download links (composite, screen, camera, mic, system audio)
    ├── Analytics section
    │   └── Redesigned drop-off chart (filled-area sparkline, see below)
    └── Danger zone
        └── Delete recording (confirm modal, calls existing soft-delete endpoint)
```

**Sticky preview behavior:**

- On screens ≥1024px, the left column uses `position: sticky; top: 24px;` so the preview stays visible while the right column scrolls.
- Below 1024px, the layout collapses to a single column with the preview at the top, and the right column flows beneath it.

**Component plan:**

- **New page** `src/app/recordings/[id]/edit/page.tsx` — server component, fetches the recording, brand options, signed downloads, drop-off buckets, view count.
- **New** `src/components/edit/edit-shell.tsx` — client component wrapping the layout grid.
- **New** `src/components/edit/edit-header.tsx` — inline rename + status + view-public-page + share URL.
- **New** `src/components/edit/preview-player.tsx` — thin wrapper around the existing `VideoPlayer` (without chapter overlay; this is just for scrubbing). May share signed-URL refresh with the share page's player.
- **New** `src/components/edit/settings-section.tsx` — brand + password forms.
- **Reuse** `src/components/viewer/trim-editor.tsx` — currently inside the OwnerToolbar; lift into its own section component on the edit page. Wiring stays identical: PUT `/api/recordings/:id/trim`, DELETE on reset.
- **Reuse** `src/components/viewer/downloads-list.tsx` — same data shape; render directly inside the Downloads section.
- **Redesigned** `src/components/edit/dropoff-chart.tsx` — replaces the current 10-bar block. New visual: filled area chart, ~80px tall, smooth curve via SVG path, accent fill at low opacity, axis labels at 0% / 50% / 100%, tooltip on hover showing exact bucket and viewer count. Same input data (10 buckets via `bucketize`).
- **New** `src/components/edit/danger-zone.tsx` — delete button + confirmation modal.
- **New title-rename API** if not present: the dashboard already supports rename via folders/move pattern, but title rename specifically may need a `PATCH /api/recordings/:id` accepting `{ title }`. Verify existing endpoints during plan; add only if missing.

**Authorization:**

- Server-side check in `page.tsx`: `auth.getUser()` → 401 / redirect; `recording.ownerId === user.id` → 404 if not.
- All POST/PATCH/DELETE endpoints invoked from this page already enforce ownership; no new API gating needed.

### Navigation

- **Dashboard recording-card menu** gains an "Edit" link → `/recordings/[id]/edit` (next to existing Move / Delete). Card click still goes to `/v/:slug`.
- **Brand header on `/v/:slug`** shows the Edit pill for owners.
- **`/recordings/[id]/edit`** shows a "View public page" link and a "Back to dashboard" link in its header.

### Empty / loading / error states

- **No chapters** — chapter segments overlay renders nothing; `ChaptersList` renders nothing; player progress bar shows native (un-segmented) Plyr.
- **No action items** — `ActionItemsBlock` renders nothing.
- **No transcript yet** — Transcript tab content shows a calm "Transcription in progress." state.
- **No comments** — Comments tab shows the comment form + "Be the first to comment." line, same as today.
- **Recording not ready** (`status !== 'ready'`) — share page shows a single calm "This recording is still being prepared." block in place of the player, plus the title and brand header. No tabs, no chapter list. Edit page handles the same state by graying out Trim / Downloads sections with a "Available once processing finishes" hint.
- **Drop-off has zero views** — the new chart renders an empty muted line at y=0 with a "No views yet." overlay.
- **Failed/expired signed URL during playback** — existing 403-triggered refresh via `/api/v/:slug/refresh-url` keeps working; no change needed.

### Design tokens & visual style

- Reuse existing tokens from `src/app/globals.css`. No new tokens required.
- Typography: existing Geist Sans / Mono. Title size on share page: ~28px (was 24px). AI summary: 15.5px / 1.65 line-height. Action items, chapter rows: 14px.
- Density: more vertical breathing room above the player and between blocks — share page's outer padding goes from `py-10` to `py-14` on desktop. The page should feel less crammed and more deliberately spaced.
- Accent usage: brand accent owns the seekbar played color and chapter-segment played color. Secondary accents (timestamp tags, hover states) use the global `--accent`.
- Tab strip: underline-style active tab (existing `border-b` pattern), generous padding, no pills.

---

## Data flow

No schema changes. All existing endpoints reused:

- `GET /v/:slug` (server component) — same query, dropped owner-only fetches (downloads, drop-off, view count) since they no longer render here.
- `GET /recordings/[id]/edit` (new server component) — fetches recording by ID with brand, transcript-status, drop-off buckets, view count, all signed downloads.
- `POST /api/v/:slug/refresh-url` — unchanged.
- `PUT /api/recordings/:id/trim`, `DELETE /api/recordings/:id/trim` — unchanged.
- `POST /api/recordings/:id/comments` — unchanged.
- `POST /api/v/:slug/unlock` (password) — unchanged. (Password gate is still on `/v/:slug` since it's a visitor flow.)
- `DELETE /api/recordings/:id` (soft delete) — already exists from Stage 1.5b; reused on the danger zone.
- `PATCH /api/recordings/:id` (title rename) — verify exists during plan; add if missing.
- `PATCH /api/recordings/:id/brand` — verify exists; add if missing.

Owner-side share-URL copy and view count migrate to the edit page header.

---

## Tests

**Unit / Vitest:**

- `chapter-segments.tsx` — given chapters and duration, returns segments with correct widths and offsets summing to 100% within float tolerance. Edge cases: 0 chapters, 1 chapter, chapter starting at 0, chapter starting after midpoint.
- `dropoff-chart.tsx` — given 10 buckets of view counts, generates an SVG path with the correct number of points and a max y matching the highest bucket.

**Playwright / E2E (existing `tests/e2e/`):**

- New `share-page.spec.ts` — load a known fixture recording, assert: title, summary, chapters list count, transcript tab default, click Comments tab → comments visible, transcript hidden; click a chapter row → player time updates; chapter segment overlay rendered with N elements.
- New `edit-page.spec.ts` — log in, visit `/recordings/[id]/edit`, assert sticky preview present, change title and reload to confirm persistence, set + clear password, verify all download links 200, drop-off chart rendered.
- Existing `tests/e2e/golden-path.spec.ts` (if present) extended to click the Edit pill from the share page after recording, confirm landing on edit page.

**Smoke (`npm run smoke`):**

- Update `scripts/e2e-smoke.mjs` to assert: HTML at `/v/:slug` no longer contains `data-owner-toolbar` (or whatever marker the toolbar exposes); HTML at `/recordings/[id]/edit` returns 200 for the owner. No new pipeline steps.

---

## Risks

- **Plyr DOM access for chapter segments.** Plyr exposes `player.elements.progress` after `ready`. Need to verify across resize and fullscreen. Fallback if it breaks: keep current `markers.points` as a safety net (Plyr's own point-markers, less polished but functional).
- **Two Plyr instances on the edit page** (preview) and the share page if a user has both open in tabs — existing behavior, just doubled. No change.
- **Sticky preview on Safari** — `position: sticky` inside a CSS grid sometimes misbehaves; verify during implementation. Fallback: scroll-margin top on the right column or non-sticky preview.
- **Tab unmount + transcript scroll** — design choice (mount-only-when-active) means TranscriptPanel remounts on tab switch back. `TranscriptPanel` already re-syncs the active-paragraph computation from its `currentTime` prop on every render, so no state is lost — but worth verifying the auto-scroll-into-view animation still feels right after a remount, not jarring.
- **URL `?tab=` collision** — none expected; existing share page doesn't use `?tab=`.
- **Migration cost for existing comments deep-links** — `#t=N` fragment still works; `?tab=` is additional, so deep-links keep behaving. Verify the comment-notification email's deep-link still lands correctly.

---

## Out of scope (explicit, repeated for clarity)

- Emoji reactions
- Inline trim handles on the seekbar (the trim editor stays as the two-range slider on the edit page)
- Mobile-specific redesign
- AI Q&A chat
- Brand profile Layers 2–5
- Outbound webhooks
- Re-encoded trim downloads

---

## Open questions

(none — all resolved during brainstorming. If any surface during writing-plans, capture them in the plan rather than re-opening the spec.)
