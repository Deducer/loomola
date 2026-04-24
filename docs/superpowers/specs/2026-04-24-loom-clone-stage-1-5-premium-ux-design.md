# Stage 1.5 — Premium UX + Organization Design

**Milestone:** Stage 1.5 (post-Stage-1 foundation)
**Goal:** Upgrade the Stage-1 UI from functional-but-clunky to premium and elegant, in the Linear / Raycast / v0 aesthetic lane; add folder organization and search/filter/sort.
**Companion to:** [`2026-04-22-loom-clone-design.md`](./2026-04-22-loom-clone-design.md) and [`project_loom_ux_polish.md`](/Users/iancross/.claude/projects/-Users-iancross-Development-03Utilities/memory/project_loom_ux_polish.md).

---

## Scope

**Phase 1.5a — Design system + full reskin:**

- CSS-variable design tokens in Tailwind (colors, typography, spacing, radii, shadows).
- Dark + light mode via `next-themes`. Dark is primary; light is a derivative, not a separate design. System-preference respected by default; user toggle persists via localStorage.
- Font: Geist Sans + Geist Mono via `next/font`.
- Icon library: `lucide-react`.
- Primitive components (minimal set — only what's needed now):
  - `Button` + `IconButton` (variants: primary / secondary / ghost / destructive)
  - `Input`, `Textarea`, `Select`
  - `Card`
  - `Badge` (variants: neutral / ready / processing / failed / uploading)
  - `Avatar` (initials fallback)
  - `Tooltip`
  - `Toast` via `sonner`
  - `ThemeToggle` dropdown (Light / Dark / System)
- Retheme every existing surface with the new tokens + primitives:
  - Top nav
  - Dashboard grid + recording card
  - Share page (/v/:slug): header, player area, transcript, chapters, action items, comments, owner toolbar (password + trim + downloads)
  - Record flow (/record): pre-record form, HUD, finished view, upload progress
  - Brand CRUD (/brands, /brands/[id], /brands/new)
  - Login page
  - Not-found / error pages (if they exist)

**Phase 1.5b — Folders + search + filter:**

- `folders` table: `id`, `owner_id`, `parent_id` (self-ref FK, nullable), `name`, `created_at`, `updated_at`. Unique `(owner_id, parent_id, name)`.
- `media_objects.folder_id` nullable FK to `folders.id` (ON DELETE SET NULL, so deleting a folder "unfiles" rather than deletes recordings).
- Folder CRUD API: create, rename, delete, move (change parent). Owner-scoped.
- Full-text search:
  - Generated `tsvector` column on `media_objects` covering `title` + `aiTitle` (coalesced) — stored, indexed with GIN.
  - Generated `tsvector` on `transcripts.full_text` — same pattern.
  - Combined search query: union of matches across both, ranked by `ts_rank`.
- Dashboard redesign:
  - Left sidebar: `All recordings`, `Unfiled`, folder tree (collapsible nodes), `New folder` button at the bottom.
  - Main area:
    - Top: page title (current folder name or "All recordings") + breadcrumbs when deep.
    - Search bar (full-width, cmd-K keybind focuses it).
    - Filter/sort row: sort dropdown (Date ↓ default, Date ↑, Duration ↓, Duration ↑, Views ↓, Title A-Z), filter pills (Status: ready / processing / failed; Brand: brand-picker).
    - Recording card grid (existing shape, new theme).
- Drag-and-drop recordings between folders — HTML5 native drag-and-drop (no library).
- Move / delete recordings from card context menu (right-click or hover ⋯ icon) + "Move to folder" picker.

**Out of scope (explicit):**

- **Tag system (many-to-many).** One folder per recording was the explicit product call.
- **Trash / soft-delete view.** Already have `deleted_at` but UI is deferred.
- **Collaborative folders / sharing.** Single-user app.
- **Folder color/icon customization.** Name-only.
- **Re-encoded trim-respecting downloads** — Stage 2 work.
- **Tag cloud / saved searches** — YAGNI.

---

## Architecture

### Phase 1.5a — Design system

**Token file (`src/app/globals.css`):**

Define CSS variables for both themes. Tailwind v4 supports arbitrary CSS vars via the `@theme` directive. Tokens grouped:

```
Color surfaces:   --bg, --bg-subtle, --bg-elevated, --border, --border-strong
Color text:       --text, --text-muted, --text-subtle
Color semantic:   --accent, --accent-hover, --success, --warning, --destructive,
                  --brand-accent (already in use, per-recording)
Radii:            --radius-sm (4), --radius (6), --radius-md (8), --radius-lg (12), --radius-xl (16)
Shadows:          --shadow-sm, --shadow (1px inset + 1 under),
                  deliberately restrained — Linear-style
```

Dark-mode values set on `:root`; light-mode under `:root.light` (next-themes flips the class). Reference values (dark):

```
--bg: #09090b        (zinc-950)
--bg-subtle: #18181b (zinc-900)
--bg-elevated: #27272a (zinc-800)
--border: #27272a
--border-strong: #3f3f46
--text: #fafafa
--text-muted: #a1a1aa
--text-subtle: #71717a
--accent: #8b5cf6    (violet-500)
--accent-hover: #7c3aed
--success: #10b981
--warning: #f59e0b
--destructive: #ef4444
```

Light mirrors these with inverted relationships (bg=white, text=zinc-950, accent=violet-600, etc.).

**`next-themes` integration:**

- Wrap `src/app/layout.tsx`'s `<body>` with `<ThemeProvider attribute="class" defaultTheme="system" enableSystem />`.
- `suppressHydrationWarning` on `<html>` to avoid SSR flash complaint.

**Font:**

- `next/font/google` with Geist + Geist Mono. Declared in `layout.tsx`, classes applied on `<body>`.
- Tailwind's `font-sans` → `var(--font-geist-sans)`; `font-mono` → `var(--font-geist-mono)`.

**Primitive components (under `src/components/ui/`):**

Each file is a single-responsibility component with variant-based styling via `cva` (`class-variance-authority` — already a standard shadcn primitive). No full shadcn install — we're hand-picking. Files:

- `button.tsx` — variants: default / secondary / ghost / destructive / outline; sizes: sm / md / lg / icon.
- `input.tsx` — base input with focus ring using `--accent`.
- `textarea.tsx` — same pattern as input.
- `select.tsx` — wraps native `<select>` with custom chevron; no popover complexity.
- `card.tsx` — simple shell with `rounded-lg border bg-bg-subtle` and `CardContent`/`CardHeader` sub-components.
- `badge.tsx` — variants for the status chips.
- `avatar.tsx` — 32px default, initials fallback from email.
- `tooltip.tsx` — thin wrapper around `@radix-ui/react-tooltip` (first radix dep; it's what shadcn uses and it's 3KB).
- `theme-toggle.tsx` — dropdown with Light / Dark / System icons (lucide).

**Surface retheme — approach:**

Work surface-by-surface, replacing raw Tailwind color classes (`bg-white/5`, `border-white/10`, `text-red-400`, etc.) with the new tokens (`bg-bg-subtle`, `border-border`, `text-destructive`). Not a full component rewrite — just replacing styling classes and swapping in the new primitives where they replace ad-hoc markup (e.g., `<button className="rounded bg-white/20 px-3 py-2 ...">` → `<Button variant="default" size="sm">`).

Order:
1. TopNav (appears on every authenticated page)
2. Dashboard + recording card
3. Share page (largest surface; owner toolbar + player + transcript + comments all at once)
4. Record flow (three states: pre-record / HUD / finished)
5. Brand CRUD
6. Login

After each surface is rethemed, visit it manually before moving to the next.

### Phase 1.5b — Organization

**Schema migration (`drizzle/00XX_*.sql`):**

```sql
CREATE TABLE folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  parent_id UUID REFERENCES folders(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX folders_unique_sibling_name
  ON folders(owner_id, COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), name);

ALTER TABLE media_objects
  ADD COLUMN folder_id UUID REFERENCES folders(id) ON DELETE SET NULL;
CREATE INDEX media_objects_folder_id_idx ON media_objects(folder_id);

-- Full-text search: generated tsvector on media_objects for title + aiTitle
ALTER TABLE media_objects ADD COLUMN search_tsv TSVECTOR
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', COALESCE(title, '')), 'A')
  ) STORED;
CREATE INDEX media_objects_search_tsv_idx ON media_objects USING GIN(search_tsv);

-- AI-generated title is in ai_outputs, not media_objects; separate tsvector there.
ALTER TABLE ai_outputs ADD COLUMN search_tsv TSVECTOR
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', COALESCE(title_suggested, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(summary, '')), 'B')
  ) STORED;
CREATE INDEX ai_outputs_search_tsv_idx ON ai_outputs USING GIN(search_tsv);

-- Transcripts: larger weight to title-adjacency is moot here; weight 'C'.
ALTER TABLE transcripts ADD COLUMN search_tsv TSVECTOR
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', COALESCE(full_text, '')), 'C')
  ) STORED;
CREATE INDEX transcripts_search_tsv_idx ON transcripts USING GIN(search_tsv);
```

Unique-sibling-name uses a COALESCE sentinel UUID for NULL parent_id (root-level folders). Same pattern as any "nullable field in a unique index" workaround.

**Drizzle schema additions:**

- `folders` pgTable mirroring the SQL above.
- `mediaObjects.folderId`, `mediaObjects.searchTsv` (ignore in TS — drizzle doesn't need to materialize generated columns; typed as `customType` with `notNull: false`).

**Folder query module (`src/db/queries/folders.ts`):**

- `listFoldersForOwner(ownerId)` — returns a flat list; the client builds the tree.
- `createFolder({ ownerId, name, parentId })`.
- `renameFolder({ id, ownerId, name })`.
- `moveFolder({ id, ownerId, newParentId })` — prevents cycles (new parent cannot be id or any descendant).
- `deleteFolder({ id, ownerId })` — CASCADE removes descendants; recordings get `folder_id = NULL`.

**Search query module (`src/db/queries/search.ts`):**

- `searchRecordings({ ownerId, query, filters, sort, folderId?, limit, offset })`.
- Joins `media_objects` LEFT JOIN `ai_outputs` LEFT JOIN `transcripts`.
- `WHERE owner_id = $1 AND deleted_at IS NULL` (always).
- If `folderId !== undefined`: add `AND folder_id = $folderId` (or `IS NULL` for the sentinel "Unfiled" pseudo-folder).
- If `query`: add `AND (media_objects.search_tsv || ai_outputs.search_tsv || transcripts.search_tsv) @@ websearch_to_tsquery('english', $q)`.
- If `filters.status`: `AND status = ANY($arr)`.
- If `filters.brandId`: `AND brand_profile_id = $bid`.
- `ORDER BY ts_rank(combined, query) DESC` if query present, else the user's sort.
- Return typed rows with the same `RecordingWithBrand` shape + `viewCount` (already there).

**Folder API routes:**

- `POST /api/folders` — body `{ name, parentId? }` → creates.
- `PATCH /api/folders/[id]` — body `{ name?, parentId? }` → rename + move in one route. Owner-checked.
- `DELETE /api/folders/[id]` — owner-checked.
- `PATCH /api/recordings/[id]/folder` — body `{ folderId: string | null }` → moves a recording to a folder (or unfiles).

**Dashboard layout:**

- Sidebar component `src/components/dashboard/folder-sidebar.tsx` — collapsible tree, drag-target wired to accept recordings and other folders.
- Search + filters component `src/components/dashboard/search-filter-bar.tsx` — search input with Cmd-K hint, sort select, status filter pills, brand filter pill.
- Main dashboard page (`src/app/page.tsx`) becomes a server component that reads query params (`?q=`, `?sort=`, `?status=`, `?brand=`, `?folder=`) and calls `searchRecordings` accordingly. URL-as-state so sharing / reloading preserves filters.
- Folder-scoped view: `/folders/[id]/page.tsx` — same layout, different default `folderId` param. Or keep the root page with `?folder=<id>` — simpler; one route. My call: single route with `?folder=<id>`.
- Breadcrumbs above the search bar when viewing a specific folder.

**Card context menu:**

- `src/components/dashboard/recording-card-menu.tsx` — a popover triggered by a hover ⋯ icon on the card. Actions: Rename, Move to folder, Delete (soft via the existing `deletedAt` — surfaces elsewhere later).
- "Move to folder" opens a cascading folder picker dialog.

**Drag-and-drop:**

- HTML5 native: `draggable=true` on card; `dragenter/dragover/drop` on folder tree nodes + on the dashboard main for "remove from folder".
- Client-side only; drop fires a PATCH to `/api/recordings/[id]/folder` then `router.refresh()`.

---

## Data flow

### Dashboard load (folder-scoped + search)

1. User visits `/?q=design+review&sort=date_desc&folder=<folderId>`.
2. Server component reads query params, calls `searchRecordings({ ownerId, query: 'design review', sort: 'date_desc', folderId, limit: 50, offset: 0 })`.
3. Separately fetches full folder list for sidebar (`listFoldersForOwner`).
4. Renders sidebar + search bar + grid.

### Create folder

1. User clicks "New folder" in sidebar → inline input.
2. Enter → POST `/api/folders` with `{ name, parentId: currentFolderId ?? null }`.
3. Server validates uniqueness; 201 with `{ folder }`.
4. `router.refresh()`.

### Move recording (drag-and-drop)

1. User drags card → drops on folder node.
2. Client reads card's `data-recording-id` + drop target's `data-folder-id`.
3. PATCH `/api/recordings/[id]/folder` with `{ folderId }`.
4. `router.refresh()`.

### Theme toggle

1. User opens ThemeToggle dropdown → picks Light/Dark/System.
2. `next-themes` updates `<html class=...>` and writes to localStorage.
3. CSS vars flip immediately (no page reload).

---

## Error handling

- Folder name collision → 409 `{ error: "name_in_use" }`; UI shows "A folder with that name already exists here."
- Folder move would create a cycle → 400 `{ error: "cycle" }`; UI reverts.
- Delete folder → CASCADE moves child folders too (and their folders, etc.); recordings in any of those folders become `folder_id = NULL` (they appear in Unfiled). Confirmation prompt before executing: "This will delete the folder and any subfolders. Recordings inside will become unfiled."
- Search with bad query → Postgres parses websearch gracefully; no errors expected.
- Drag-and-drop: if PATCH fails, toast with "Move failed" and refresh (reverts optimistic state).
- Theme flash on first load: mitigated by `next-themes` SSR snippet injected in `<head>`.

---

## Testing

### Unit (Vitest)

- `tests/unit/folder-cycle-check.test.ts` — test the cycle-detection helper (new folder's new parent cannot be self or any descendant).
- `tests/unit/search-ranking.test.ts` — integration-ish; spin up a Postgres fixture, insert a handful of recordings, verify `searchRecordings` returns by rank. (Realistic; the ranking is the part worth testing.)
- **Skipping:** unit tests for primitive components. Their behavior is mostly CSS variance and trivial prop passing. Visual regression would be better but is out of scope.

### Manual live smoke (after each phase)

**Phase 1.5a:**
- Visit every surface (/, /record, /v/:slug, /brands, /brands/new, /brands/[id], /login) in both dark and light modes.
- Theme toggle from top nav flips all surfaces instantly with no flash.
- Keyboard navigation works on primitives.

**Phase 1.5b:**
- Create a folder, nest another inside, create a third at root.
- Drag a recording from Unfiled into a nested folder.
- Drag a folder into another folder (re-parent).
- Rename a folder.
- Delete a folder with recordings inside — confirm recordings become unfiled.
- Search for a word from a recording's transcript → matches rank below title matches but appear.
- Filter by status=ready.
- Sort by duration ↑.
- Cmd-K focuses search.
- URL reflects state — copy, paste in a new tab, same view.

### Existing smoke

`npm run smoke` keeps passing after each phase (verifies the underlying pipeline is untouched).

---

## Environment

Phase 1.5a:
- New deps: `next-themes`, `lucide-react`, `class-variance-authority`, `clsx`, `tailwind-merge`, `@radix-ui/react-tooltip`, `sonner`, `geist`.
- No new secrets.

Phase 1.5b:
- No new deps.
- No new secrets.

---

## Risks

- **Theme flash on first paint**: `next-themes` injects a small inline script that reads localStorage before React hydrates. Solved as long as the ThemeProvider is placed correctly; flagged for manual verification.
- **Token inversion in light mode**: some Stage-1 components use `text-white/60` or `border-white/10` — these don't auto-invert. The reskin explicitly replaces them with tokens; we need to catch them all or light mode will look broken. Grep audit as part of the execution.
- **Postgres tsvector on generated columns**: requires Postgres ≥ 12. Supabase is 15+, so safe.
- **Folder cycle on move**: explicit check in the API; tested.
- **Drag-and-drop on mobile**: HTML5 DnD doesn't work on touch. Acceptable for now — desktop-first app.
- **Retheming scope**: the existing codebase has many ad-hoc color classes. The audit will be tedious but mechanical. Accept some drift and follow up on the first user-visible regression.
- **Existing comments form + trim editor + password popover**: all need re-themed but also functionally preserved. I'll keep behavior intact and only touch styling.
