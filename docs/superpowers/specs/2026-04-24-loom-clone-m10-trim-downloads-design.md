# M10 — Trim Editing + Raw Track Downloads Design

**Milestone:** M10 (of Stage 1)
**Goal:** Let the creator trim the playable range of a recording (playback-only, no re-encoding) and download the raw per-track webm files off R2.
**Companion to:** [`2026-04-22-loom-clone-design.md`](./2026-04-22-loom-clone-design.md) → "Viewer / Share Page" → "Trim editing (E2)" and "Other creator-only actions".

---

## Scope

**In — Trim editing (owner-only):**

- New "Trim" section in the existing owner toolbar on `/v/:slug`. Clicking opens a two-handle range slider over the full recording duration.
- Save action writes `media_objects.trim_start_sec` / `trim_end_sec` via `PUT /api/recordings/:id/trim`.
- Reset action clears both columns via `DELETE /api/recordings/:id/trim`.
- Player clamping on the viewer side: on `loadedmetadata`, if `trim_start_sec != null`, seek to it; on `timeupdate`, if `currentTime >= trim_end_sec`, pause and snap back to `trim_end_sec - 0.05`.
- Schema columns already exist on `media_objects` from M2; no migration.

**In — Raw track downloads (owner-only):**

- New "Downloads" card in the owner toolbar. One row per R2 key that is non-null on the recording (`Composite`, `Screen`, `Camera`, `Mic`, `System audio`).
- Each row is an anchor with a signed R2 GET URL that carries `Content-Disposition: attachment; filename="<slug>-<kind>.webm"`. Clicking triggers a browser download directly from R2 — no server streaming.

**Out of scope:**

- **ZIP bundle download** — individual links cover the stated use case (get the raw files off the server) without adding streaming infrastructure.
- **Trim re-encoding** — the stored composite stays full-length; trim is playback-only. Downloading the composite gives the full recording, not the trimmed range.
- **Visual trim-range overlay on Plyr's seek bar** — plain JS clamp is enough for a first pass; revisit if it feels off.
- **Live preview while dragging trim handles** (seeking the player to match handle position as you drag) — revisit if first pass feels clunky.
- **Creator-only comment reply, title edit, delete recording, change brand** — separate cleanup milestone; not M10.

---

## Architecture

### Server routes

- `src/app/api/recordings/[id]/trim/route.ts` — owner-only `PUT` and `DELETE`.
  - `PUT` body: `{ startSec: number, endSec: number }`. Calls the shared `validateTrim` helper with `durationSec = rec.durationSeconds`; 400 on invalid bounds; 404 on non-owned or unknown id; on success, persists and returns `{ ok: true }`.
  - `DELETE`: sets both columns to null, returns `{ ok: true }`.
- No new route for raw downloads — the signed GET URL is computed inside the page's server component and passed into the client tree as an `href`.

### DB queries

- `src/db/queries/recordings.ts` — add two small helpers:
  - `updateTrim({ id, ownerId, startSec, endSec })` — updates both columns when ownership matches; returns `true` if one row was updated.
  - `clearTrim({ id, ownerId })` — sets both columns to null; returns boolean.
- `RecordingWithBrand` already surfaces `trimStartSec` and `trimEndSec` through the `...row.rec` spread; no type changes.

### R2 helper update

- `src/lib/r2/presigned-get.ts` — overload `presignGet(key, opts?: { filename?: string })`. When `opts.filename` is provided, the `GetObjectCommand` gains `ResponseContentDisposition: 'attachment; filename="..."'`. Existing call-sites (`presignGet(key)` with no second arg) are unchanged.

### Pure utility

- `src/lib/viewer/trim-validate.ts` — exports `validateTrim({ startSec, endSec, durationSec }) → { ok: true } | { ok: false, error: 'start_negative' | 'end_out_of_bounds' | 'start_ge_end' }`.
  - Tolerance: `endSec` is allowed up to `durationSec + 0.5` to absorb small timestamp imprecision; clamped at write time.
  - This function is the single source of truth used by both the route (400 validation) and the client editor (disable Save with a matching message).

### Client components

- `src/components/viewer/trim-editor.tsx` — client component. Props: `recordingId: string`, `durationSec: number`, `initialStart: number | null`, `initialEnd: number | null`. Renders a collapsed button ("Trim: off" / "Trim: 0:03–0:10"); clicking expands a panel with:
  - Two `<input type="range">` handles stacked with CSS; the lower handle sets start, the upper sets end. Step = 0.5s.
  - Labels showing the current `[M:SS] – [M:SS]` values.
  - Save button (disabled when `validateTrim` returns `ok: false`), Reset button (calls `DELETE`), Cancel button (collapses without saving).
  - Save → PUT → `router.refresh()`. Reset → DELETE → `router.refresh()`.
- `src/components/viewer/downloads-list.tsx` — client component (only because it lives inside the client toolbar tree; it has no state). Props: `links: Array<{ kind: string; href: string }>`. Renders a simple list of anchors with the `download` attribute for good measure.

### Wiring

- `src/components/viewer/owner-toolbar.tsx` — gains two new child sections beneath the existing password row: `<TrimEditor>` and `<DownloadsList>`. Owner-toolbar needs more props now (`durationSec`, `trimStartSec`, `trimEndSec`, `downloads`), but the single existing owner-toolbar surface is still the right home — it's the one place all creator-only controls live.
- `src/components/viewer/viewer-shell.tsx` — gains `trimStartSec: number | null` and `trimEndSec: number | null` props, passes them into `<VideoPlayer>`.
- `src/components/viewer/video-player.tsx` — gains `trimStartSec` + `trimEndSec` props. In the Plyr setup effect, attaches a `loadedmetadata` listener: if `trimStartSec != null` and `currentTime < trimStartSec`, calls `seek(trimStartSec)`. In the existing `timeupdate` listener: if `trimEndSec != null` and `currentTime >= trimEndSec`, calls `plyr.pause()` and sets `currentTime = trimEndSec - 0.05`.

### Page

- `src/app/v/[slug]/page.tsx` — server component builds `downloads` by iterating the recording's five R2 key fields and calling `presignGet(key, { filename: `${slug}-${kind}.webm` })` for each non-null one. Passes `downloads`, `trimStartSec`, `trimEndSec`, `durationSec` into the appropriate parts of the tree.

---

## Data flow

### Setting a trim

1. Owner clicks "Trim" in toolbar → editor panel expands.
2. Owner drags handles → labels update live via local state.
3. Client clicks Save. `validateTrim` passes. PUT `/api/recordings/:id/trim { startSec, endSec }`.
4. Server re-runs `validateTrim` against the recording's `durationSeconds`, persists, returns 200.
5. Client `router.refresh()` → server re-renders the page with new `trim_start_sec` / `trim_end_sec` → the values flow into `<VideoPlayer>`.
6. Next `loadedmetadata` (either on page mount or after the existing `video.load()` reset) fires → player seeks to `trimStartSec`.

### Clearing a trim

1. Owner clicks Reset → DELETE `/api/recordings/:id/trim` → both columns become null → `router.refresh()` → VideoPlayer sees nulls → clamps no-op.

### Viewer playback with trim set

1. Page load → server emits `trimStartSec = 3`, `trimEndSec = 10` on a 15s recording.
2. VideoPlayer's Plyr + video mount. On `loadedmetadata`: currentTime is 0, `0 < 3`, so seek to 3.
3. Viewer presses play. Playback advances from 3s.
4. Every 250ms Plyr emits `timeupdate`. When `currentTime >= 10`, pause + seek to 9.95.
5. If the viewer scrubs to 12s via the Plyr progress bar, the next `timeupdate` snaps back to 9.95.

### Downloading a raw track

1. Owner's page load → server presigns each non-null R2 key with a forced attachment filename.
2. Owner clicks "Screen" → browser follows the signed URL → R2 returns the bytes with `Content-Disposition: attachment; filename="V2LyopYmWS-screen.webm"` → browser saves the file.

---

## Error handling

- Trim PUT with invalid bounds → 400 `{ error: "start_negative" | "end_out_of_bounds" | "start_ge_end" }`. Editor shows the corresponding message inline.
- Trim PUT on an unknown or non-owned recording → 404 (no-leak).
- Trim DELETE on an unknown or non-owned recording → 404.
- Recording with `durationSeconds` null (shouldn't happen for a ready recording, but possible mid-processing) → `<TrimEditor>` renders a disabled state with "Duration not available yet — try again after the recording finishes processing".
- Stale trim values (e.g., `trimEndSec > durationSec` because duration was later corrected) → `<VideoPlayer>` clamps `trimEndSec` to `durationSec` before applying.
- Signed download URL expires mid-click → user gets an R2 403 page; reload regenerates the URL. Fine at this scale.
- Clicking Reset while the editor's local state has unsaved edits → Reset clears BOTH the server state and the editor state (simpler than distinguishing).

---

## Testing

### Unit (Vitest, under `tests/unit/`)

- `trim-validate.test.ts`:
  - Happy path: `startSec=0`, `endSec=10`, `durationSec=15` → `{ ok: true }`.
  - Happy path at boundary: `startSec=0`, `endSec=15` → ok.
  - Happy path with tolerance: `endSec=15.3` against `durationSec=15` → ok (within 0.5 tolerance).
  - Negative start: `startSec=-1` → `{ ok: false, error: 'start_negative' }`.
  - End over duration + tolerance: `endSec=16` against `durationSec=15` → `{ ok: false, error: 'end_out_of_bounds' }`.
  - Start >= end: `startSec=10`, `endSec=10` → `{ ok: false, error: 'start_ge_end' }`; `startSec=11`, `endSec=10` → same.

### Manual live smoke (after deploy)

- Owner opens `/v/<ready-slug>` → toolbar shows "Trim: off" button and "Downloads" card listing the non-null tracks.
- Click Trim → panel expands; drag start to 0:03 and end to 0:10 on a 15s clip → Save → toolbar now shows "Trim: 0:03–0:10".
- Refresh page → player auto-seeks to 0:03 on ready.
- Press play → at 0:10 the player pauses (visible; the progress bar stops advancing).
- Scrub past 0:10 via the Plyr bar → playback snaps back to just before 0:10 on next tick.
- Open the same slug in an incognito window (non-owner) → same clamp behavior; no trim editor or downloads visible.
- Click Reset → refresh → player plays the full thing again.
- Click "Composite" in Downloads → browser downloads `<slug>-composite.webm`. File opens in a native player.
- Click each other track that's present (Screen/Camera/Mic/System audio) → each downloads with a distinct filename.

### Skipped

- Playwright E2E — same rationale as M7/M8/M9 (player + range inputs + signed URL timing is flaky in headless).

---

## Environment

No new secrets, no new dependencies. Reuses `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` already in the project.

---

## Risks

- **Native `<input type="range">` dual-handle styling** is inconsistent across browsers. We stack two ranges with CSS + pointer-events tricks; acceptable for our Chrome-first creator. If it ends up visually broken in Safari we revisit with `rc-slider` or similar.
- **Trim clamp race condition** — Plyr's `timeupdate` fires at ~250ms cadence; viewer can momentarily play past `trim_end_sec` by up to a quarter-second before we pause. Acceptable Loom-style behavior.
- **Content-Disposition honored by R2** — Cloudflare R2 respects the `ResponseContentDisposition` GET parameter on signed URLs; we should verify during live smoke that the browser actually downloads (rather than plays inline) the first time. If it doesn't, fallback is to render anchor tags with `download="<filename>.webm"`, which is a browser-side hint; still works in practice.
- **Signed URL expiry (1h)** — download links on a page left open > 1h will 403. Mitigation: user reloads the page. A refresh-on-click pattern is overkill for M10.
