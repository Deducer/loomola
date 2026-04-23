# M8 — Password Protect + View Tracking Design

**Milestone:** M8 (of Stage 1)
**Goal:** Gate selected recordings behind per-video passwords and track anonymous views with a drop-off chart visible to the creator.
**Companion to:** [`2026-04-22-loom-clone-design.md`](./2026-04-22-loom-clone-design.md) → "Viewer / Share Page" + "Creator Dashboard" sections.

---

## Scope

**In — Password protect:**

- Viewer: if `media_objects.password_hash IS NOT NULL` and the browser doesn't have a valid unlock cookie for that slug, `/v/:slug` renders a password form instead of the viewer.
- Viewer: submitting the form POSTs to `/v/:slug/unlock`; the server bcrypt-verifies against that recording's hash and, on success, sets a signed cookie scoped to the slug (24h TTL). Redirects back to `/v/:slug`.
- Creator: owner-only toolbar on `/v/:slug` with a password toggle. Inline popover form for setting a new password (plaintext input, bcrypt-hashed server-side before storage) and a "Remove password" button.
- API: `POST /api/v/:slug/refresh-url` also checks the unlock cookie; returns `403 {"error":"locked"}` when password is set and cookie is missing/invalid.
- Changing a password invalidates all outstanding unlock cookies (the HMAC covers the password hash).

**In — View tracking:**

- `POST /api/v/:slug/view` fires on the first `play` event per page load; server derives `visitor_hash = SHA-256(IP + UA-summary + VISITOR_HASH_SALT)` and upserts a row in `views`.
- `POST /api/v/:slug/progress` fires every 5s while playing, via `navigator.sendBeacon`, with JSON body `{ t: number }`. Server updates `max_watched_sec` (only if higher) and increments `watched_seconds`.
- Dashboard card renders a view count next to duration.
- Owner-only drop-off chart on `/v/:slug`: ten bars (bucketized over recording duration) showing how many viewers reached each bucket. Pure CSS (no chart library).
- Owner viewing their own recording: no `<Tracking>` component is rendered server-side when `isOwner === true`, so no view row is created.

**Out (deferred or intentionally dropped):**

- Per-view session timeline or play/pause scrubbing heatmap — aggregate buckets are enough.
- Country-level breakdown in UI — `views.viewer_country` column exists but GeoIP resolution is deferred.
- Email notifications on new views — M9 comments will handle the "did anyone care?" signal.
- Account lockout / rate-limit on wrong passwords — simple bcrypt check only; tiny blast radius (one recording per attack).
- Creator-only password strength meter, reveal-toggle, or password-manager hinting — one plain input, one Save button.

---

## Architecture

### Server routes

- `src/app/v/[slug]/page.tsx` — adds lock detection, `<PasswordGate>` branch, owner-only toolbar, owner-only `viewCount` + `dropoffBuckets` fetching. No change to the viewer rendering path for unlocked/unpassworded recordings.
- `src/app/v/[slug]/unlock/route.ts` — `POST` body `{ password: string }` → `bcrypt.compare(password, rec.password_hash)` → set cookie `view_unlock_<slug>` with `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=86400`; 303 redirect back to `/v/:slug`.
- `src/app/api/v/[slug]/refresh-url/route.ts` — modify existing route: if `rec.password_hash` is set, require a valid unlock cookie; else proceed as today.
- `src/app/api/v/[slug]/view/route.ts` — `POST`; derive visitor hash from headers; upsert into `views`.
- `src/app/api/v/[slug]/progress/route.ts` — `POST` body `{ t: number }`; update row matched on `(media_object_id, visitor_hash)`; lazy-create the row if missing.
- `src/app/api/recordings/[id]/password/route.ts` — owner-only `PUT` (body `{ password: string }`, sets new hash) and `DELETE` (clears hash). Requires authenticated session + ownership check.

### Pure server helpers

- `src/lib/viewer/unlock-cookie.ts`
  - `cookieName(slug) → string` — returns `view_unlock_${slug}`.
  - `signUnlockToken({ slug, passwordHash }) → string` — `HMAC-SHA256(VIEW_UNLOCK_SECRET, slug + ':' + passwordHash).hex`.
  - `verifyUnlockToken({ slug, passwordHash, token }) → boolean` — constant-time compare; returns false if password hash is null (no password set).
- `src/lib/viewer/visitor-id.ts`
  - `hashVisitor(request: Request) → string` — SHA-256 over `ip + '\n' + uaSummary + '\n' + VISITOR_HASH_SALT`. `ip` uses `X-Forwarded-For` first, falls back to `X-Real-IP`, falls back to empty string. `uaSummary` is the first 64 chars of `user-agent` header.
- `src/lib/viewer/dropoff.ts`
  - `bucketize(maxWatchedSecsPerViewer: number[], durationSec: number, bucketCount = 10) → number[]` — returns an array of bucket counts. A viewer's `max_watched_sec` is placed in bucket `floor(max / (durationSec / bucketCount))`, clamped to `[0, bucketCount-1]`.

### DB queries (`src/db/queries/views.ts`, new)

- `upsertView({ mediaObjectId, visitorHash, userAgentSummary })` — inserts or bumps `updated_at` when the row already exists. Deduplication window: 30 min (if `updated_at < now() - interval '30 min'`, treat as a new view by resetting `updated_at` only — we do NOT insert duplicate rows; deduplication keeps the table tidy).
- `updateProgress({ mediaObjectId, visitorHash, currentTimeSec })` — lazy insert, then `UPDATE SET max_watched_sec = GREATEST(max_watched_sec, $currentTimeSec), watched_seconds = watched_seconds + 5`.
- `countViews(mediaObjectId) → number` — `SELECT COUNT(*) WHERE media_object_id = $1`.
- `listViewCounts(mediaObjectIds: string[]) → Record<string, number>` — batched equivalent for dashboard.
- `listMaxWatched(mediaObjectId) → number[]` — `SELECT max_watched_sec FROM views WHERE media_object_id = $1` — fed to `bucketize()`.

### Client components (under `src/components/viewer/`)

- `password-gate.tsx` — form. On submit, POST to `/v/:slug/unlock` with `{ password }`. On 200/303, `router.refresh()`. On 401, show "Incorrect password."
- `owner-toolbar.tsx` — renders only when server marks `isOwner`. Two states:
  - `password_hash` is null → "Password: off" + "Add password" button opens popover with password input + Save.
  - `password_hash` is non-null → "Password: on" + "Change" + "Remove" buttons.
- `tracking.tsx` — `"use client"`, effect-only, returns `null`. Attaches to the `<video>` element via a shared ref or via a small pub/sub event the viewer-shell exposes. Fires view POST on first `play`; starts a 5s interval while playing; clears the interval on `pause` / `ended`. Uses `navigator.sendBeacon` when available, falling back to `fetch` with `keepalive: true`.
- `dropoff-chart.tsx` — pure layout; takes `buckets: number[]` and renders flex children with heights scaled to `max(...buckets)`. No chart library.

### Dashboard wiring

- `src/db/queries/recordings.ts` — `listRecordings` gains a `viewCount` field via a `LEFT JOIN LATERAL (SELECT count(*) FROM views WHERE media_object_id = mo.id)` or a subquery-in-select. Keeps the query single-statement.
- `src/components/dashboard/recording-card.tsx` — renders `"{viewCount} views"` next to duration when > 0. Hidden when zero to avoid noise on fresh recordings.

### Coordination between the player and the tracker

`<Tracking>` needs to observe the `<video>`'s `play` / `pause` / `ended` events and read `currentTime` periodically. Options:

- **Preferred**: expose a player-event subscription from `<ViewerShell>`. Shell already owns `playerRef` and `currentTime`. Add an `onPlayStateChange(isPlaying: boolean) => void` prop that `<VideoPlayer>` calls when Plyr emits `play` / `pause` / `ended`. `<Tracking>` is rendered as a child of `<ViewerShell>` and receives:
  - `slug`
  - `isOwner` — if true, the component returns `null` immediately
  - `isPlaying` — prop from shell
  - `getCurrentTime(): number` — callback from shell (reads `playerRef.current.getCurrentTime()`)
- This keeps `<Tracking>` dumb: it only owns the 5s timer and the fetch call.

---

## Data flow

### Password-locked recording

1. Unauthenticated viewer visits `/v/:slug`.
2. Server loads recording; `password_hash` is non-null.
3. Server reads `cookies().get("view_unlock_<slug>")`; token absent → render `<PasswordGate>` and short-circuit.
4. Viewer submits form → POST `/v/:slug/unlock` with `{ password }`.
5. Server bcrypt-compares; match → set signed cookie with 24h TTL; 303 redirect to `/v/:slug`.
6. Follow-up request has the cookie; server calls `verifyUnlockToken` (constant-time HMAC compare including current `password_hash`); valid → render the normal viewer.
7. Client's `<VideoPlayer>` issues a fresh signed R2 URL via `/api/v/:slug/refresh-url` on 403 from the initial URL. The refresh endpoint also checks the unlock cookie.

### View tracking

1. Non-owner viewer presses play.
2. `<VideoPlayer>` fires Plyr `play` event → `<ViewerShell>` flips `isPlaying=true` → `<Tracking>` sees the transition and POSTs `/api/v/:slug/view`.
3. Server upserts `views` keyed by `(media_object_id, visitor_hash)`.
4. While `isPlaying=true`, `<Tracking>` fires `navigator.sendBeacon('/api/v/:slug/progress', JSON.stringify({ t }))` every 5s with `t = getCurrentTime()`.
5. Server updates `max_watched_sec = GREATEST(…)` and increments `watched_seconds`.
6. On `pause` / `ended` / unmount, the interval clears; no teardown request needed (best-effort tracking).

### Owner drop-off chart

1. Owner visits `/v/:slug`.
2. Server calls `listMaxWatched(rec.id)` → `number[]`.
3. Server calls `bucketize(maxList, rec.durationSeconds, 10)` → `number[]` of length 10.
4. `<DropoffChart buckets={buckets} />` renders ten bars below the viewer UI.

### Creator setting / removing a password

1. Owner-only toolbar shows "Password: off" + "Add password".
2. Click → inline form with password input + Save.
3. Submit → `PUT /api/recordings/:id/password` with `{ password }`; server bcrypts and writes `password_hash`.
4. Toolbar re-renders "Password: on" with Change / Remove.
5. Click Remove → `DELETE /api/recordings/:id/password` → server sets `password_hash = NULL`.
6. Cookie-side: any old unlock cookies stop verifying because the HMAC key path includes `password_hash`. No explicit invalidation needed.

---

## Error handling

- Wrong password → server returns `401 {"error":"bad_password"}`; form shows "Incorrect password." No lockout in M8.
- Tampered / expired unlock cookie → `verifyUnlockToken` returns false → password form shown again; the cookie is not explicitly cleared (it will just fail on every request until naturally expiring or being overwritten).
- Password change invalidates cookies implicitly (HMAC covers the hash). Documented in `unlock-cookie.ts` JSDoc.
- Creator removes password → `password_hash IS NULL` → cookie check skipped entirely; any leftover cookies are ignored (harmless).
- Refresh-URL endpoint with password set and invalid/missing cookie → `403 {"error":"locked"}`; the player's existing 403 handler surfaces a "Playback interrupted" banner (acceptable UX — the viewer can reload and re-enter the password).
- Progress POST before view POST → server does a lazy upsert on the views row; no error.
- `sendBeacon` failure (tab closed mid-request, beacon queue full) → silently dropped; acceptable data loss of up to 5s.
- Visitor with no `X-Forwarded-For` and no `X-Real-IP` → IP falls back to empty string; all such viewers collapse to a single row. Tiny in practice.
- Owner accidentally viewing in an incognito window → counts as a regular viewer. Not possible to detect without a session. Acceptable.

---

## Testing

### Unit (Vitest, under `tests/unit/`)

- `unlock-cookie.test.ts`
  - `signUnlockToken` returns deterministic hex for the same inputs.
  - `verifyUnlockToken` accepts its own output; rejects tampered tokens; rejects when password hash changed.
  - Returns false when `passwordHash` is null (no password set → no cookie should be accepted).
- `visitor-id.test.ts`
  - Same `(ip, ua)` inputs → same hash.
  - Different inputs → different hashes.
  - Empty IP and empty UA → stable hash (distinct from any real input).
- `dropoff-bucketize.test.ts`
  - Empty input → `[0,0,0,0,0,0,0,0,0,0]`.
  - Single viewer at exactly half the duration → bucket 5 incremented.
  - Viewer with `max_watched_sec > durationSec` → clamps to bucket 9 (last).
  - Viewer with `max_watched_sec = 0` → bucket 0.
  - 100 viewers spread linearly → roughly uniform across buckets (soft assertion).

### Manual live smoke (after deploy)

- Creator flow:
  - `/v/V2LyopYmWS` as owner → toolbar shows "Password: off".
  - Click "Add password" → set `"loom-test-123"` → toolbar flips to "Password: on".
  - Open same URL in an incognito window → password form.
  - Wrong password → "Incorrect password" error.
  - Correct password → cookie set, page reloads into viewer.
  - Close + reopen incognito (same browser session) within 24h → viewer, no form.
  - As owner, click "Remove password" → incognito window reloads without form.
- Tracking flow:
  - In incognito, play a recording for ~30s → disconnect the video → in a psql, `SELECT media_object_id, max_watched_sec, watched_seconds FROM views WHERE ...` shows a row with `max_watched_sec ≈ 25-30`.
  - Dashboard (as owner) → card shows "1 view".
  - Owner `/v/:slug` → drop-off chart rendered with bars at the watched portion.
  - Play as signed-in owner → no new view row created.

### Skipped

- Playwright — same reasons as M7 (cookie + player + beacon timing flakes in headless).
- Load testing of `/progress` beacon — single-creator app; real load is under 1 rps.

---

## Environment additions

Two server secrets are added to Doppler `prd_loom` before implementation starts:

- `VIEW_UNLOCK_SECRET` — 32 random bytes, hex (HMAC key for unlock cookies).
- `VISITOR_HASH_SALT` — 32 random bytes, hex (salts IP-hash so DB values aren't reversible without this salt).

Both have already been generated and written to Doppler. No CI / `.env.local` changes needed — Doppler CLI injects them at container boot in prod and at `npm run dev` in local via `doppler run --`.

`bcryptjs` is added as a dependency; it's pure JS (no native build) so it works in the Next.js runtime path without platform concerns.

---

## Risks

- **bcrypt in a serverless-style Node route handler**: Next.js route handlers on Vercel would be a concern but we're self-hosted on Coolify with Node runtime — bcryptjs works fine and the latency of a single hash (~50 ms on modest hardware) is acceptable.
- **sendBeacon size limits and discarded payloads in background tabs**: Chrome drops beacons > 64KB; our payload is `{"t": 123.45}` — trivially under the limit. Background tabs throttle setInterval, meaning progress updates slow down; that's acceptable (we just get fewer data points).
- **Cookie policy quirks with Safari ITP**: first-party cookies on an HTTPS site with `SameSite=Lax` work for our flow (the redirect after POST is same-origin). No known ITP blocker.
- **Password UX**: no password strength meter, no reveal toggle. Intentional for M8 simplicity; trivial follow-up if the creator wants it.
- **Owner detection on refresh-url endpoint**: the refresh route currently has no auth context. If we wanted to let owner refresh without the unlock cookie, we'd need to plumb Supabase session in. Not worth it — owner can just hit the password form once like anyone else.
