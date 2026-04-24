# M9 — Comments + Mailgun Notifications Design

**Milestone:** M9 (of Stage 1)
**Goal:** Anonymous timestamped comments on the public `/v/:slug` viewer, with immediate Mailgun email notifications to the creator.
**Companion to:** [`2026-04-22-loom-clone-design.md`](./2026-04-22-loom-clone-design.md) → "Viewer / Share Page" → "Comments (V4)" section.

---

## Scope

**In:**

- Anonymous public comment submission from `/v/:slug`: form with `name`, `email`, `body`, and an auto-captured playhead timestamp. No account required.
- Comments render as a flat chronological thread (`Comments (N)` heading + list) below the action-items list in the existing viewer layout.
- Each comment row: `[M:SS]` timestamp button (click-to-seek), commenter name, body, relative date.
- Owner-only trash-icon button on each comment; hard-deletes.
- Per-visitor rate limit: 3 comments in any 5-minute rolling window (reuses the M8 visitor-hash; in-memory LRU on the single container).
- On new comment: fire-and-forget Mailgun email to the recording's owner with commenter name + email + timestamp + body + a deep link to the comment on `/v/:slug`.
- Password-protected recordings: posting a comment requires a valid unlock cookie (403 otherwise).

**Out of scope / intentionally dropped:**

- **hCaptcha** — rate limit + email-required is enough friction at solo-creator scale. Re-evaluate if spam appears.
- **Threaded replies** — flat list only.
- **Owner in-page replies** — owner replies out-of-band using the email in their notification.
- **Comment edit** — skip.
- **Confirmation email to the commenter** — skip.
- **Digest emails** — immediate only.
- **Email verification for commenters** — honor-system name + email.
- **Seek-bar comment pins** — deferred. Click-to-seek from the comments list gives the same navigation utility; adding same-color markers to a seek bar that already shows chapter markers would be visually confusing, and a distinct-color overlay is enough dev work to merit its own polish pass.
- **pg-boss job for email delivery** — fire synchronously in the request handler with try/catch. If Mailgun fails, we log and return success; the comment is persisted regardless.

**Privacy:**

- Commenter email is **never shown on the share page** — only appears in the owner's notification email. Owners reply out-of-band.
- Commenter name is public.

---

## Architecture

### Server routes

- `src/app/api/v/[slug]/comments/route.ts` — `POST`. Body: `{ name: string, email: string, timestampSec: number, body: string }`. Steps: validate fields, enforce password unlock if the recording is locked, check rate limit, insert comment, fire Mailgun in background, return `201 { id }`.
- `src/app/api/comments/[id]/route.ts` — `DELETE`. Owner-only; `requireAuth()`, validates ownership via join, hard-deletes.

### DB queries (`src/db/queries/comments.ts`, new)

- `createComment({ mediaObjectId, name, email, timestampSec, body }) → Comment` — single insert, returns full row.
- `listCommentsForRecording(mediaObjectId) → Comment[]` — ordered by `created_at` asc.
- `deleteCommentOwned({ commentId, ownerId }) → boolean` — deletes from `comments` where `id = $1` AND the joined `media_objects.owner_id = $2`. Returns true iff a row was deleted.

### Rate limiter (`src/lib/comments/rate-limit.ts`, new)

- Pure in-memory LRU keyed by visitor-hash.
- `checkAndBump(visitorHash) → { allowed: boolean, retryAfterSec?: number }`.
- Window: 5 minutes. Allowance: 3 hits per window. Implemented as `Map<string, number[]>` of timestamp lists; on each call, prunes entries older than `now - 5min`, then compares length to the allowance.
- LRU cap: 10,000 entries. When exceeded, drop the oldest entries. Prevents unbounded memory growth on a botnet flood. (Dropping an entry gives the visitor back their full allowance, which is a tiny leak — acceptable given the cap.)
- Reset doesn't survive container restart. Acceptable at this scale.

### Mailgun module (`src/lib/mail/mailgun.ts`, new)

- `sendEmail({ to, subject, text, html }) → Promise<void>` — wraps the Mailgun HTTP API directly (`POST https://api.mailgun.net/v3/<MAILGUN_DOMAIN>/messages`, basic auth `api:<MAILGUN_API_KEY>`, form-encoded body). No SDK dependency.
- `MAIL_FROM_ADDRESS` is used as the `from` field verbatim (already formatted with display name + address in Doppler).
- Throws on non-2xx; callers decide whether to catch.

### Email template (`src/lib/mail/templates/new-comment.ts`, new)

- `renderNewCommentEmail(params) → { subject, text, html }`.
- Params: `recordingTitle, commenterName, commenterEmail, body, timestampSec, shareUrl`.
- `subject`: `"New comment from <name> on <title>"` (truncated to 100 chars).
- `text`: plaintext fallback with all fields + the deep link `<shareUrl>#t=<sec>`.
- `html`: simple inline-styled HTML; escapes `< > &` in the body and name; the timestamp is formatted `M:SS`.

### Client components (under `src/components/viewer/`)

- `comments-section.tsx` — accepts `comments`, `slug`, `recordingId`, `isOwner`, and a `getCurrentTime: () => number` prop. Renders the heading + `<CommentList>` + `<CommentForm>`.
- `comment-form.tsx` — controlled form (name, email, body). On submit: POST, handle 201 / 400 / 403 / 429 cases with distinct inline messages.
- `comment-list.tsx` — maps over comments; delegates each row to `<CommentItem>`.
- `comment-item.tsx` — `[M:SS]` button (→ `onSeek`), name, body, relative date, and owner-only trash-icon button → DELETE + `router.refresh()`.

### Wiring into `<ViewerShell>` + page

- `src/app/v/[slug]/page.tsx` loads comments server-side (via `listCommentsForRecording`) alongside the existing fetches and passes them into `<ViewerShell>` as a new prop.
- `<ViewerShell>` renders `<CommentsSection>` as its last child — below `<ChaptersList>` and `<ActionItemsList>` — so the form can reuse the same `getCurrentTime()` and `onSeek()` callbacks the shell already owns. This keeps all viewer children uniform in how they interact with the player.

---

## Data flow

### Comment submission

1. Viewer types name/email/body → clicks Submit.
2. Client snapshots playhead via `getCurrentTime()`, POSTs `/api/v/:slug/comments` with `{ name, email, timestampSec, body }`.
3. Server:
   a. Looks up recording by slug. If missing → 404.
   b. If `password_hash` set, verifies unlock cookie → 403 on miss.
   c. Validates fields (non-empty name/body, email regex, body ≤ 2000 chars).
   d. Derives `visitorHash` from headers; calls `checkAndBump`. If blocked → 429 with `retryAfterSec`.
   e. Inserts comment.
   f. Fires `void sendNewCommentEmail(...)` — no `await`. Errors caught internally and logged.
   g. Returns 201 `{ id }`.
4. Client `router.refresh()`; new comment appears in the list on the next render.

### Comment delete (owner)

1. Owner clicks trash on a comment row.
2. Client DELETEs `/api/comments/:id`.
3. Server `requireAuth()` → `deleteCommentOwned({ commentId, ownerId })`. Returns true → 200; false → 404.
4. Client `router.refresh()`.

### Deep link from email

1. Email's CTA link: `<shareUrl>#t=<sec>` (e.g., `https://loom.dissonance.cloud/v/abc123#t=42`).
2. Client-side: the viewer-shell reads `window.location.hash` after mount. If `#t=N`, calls `playerRef.current.seek(N)` once the player is ready.
3. If no hash, no seek — normal load.

---

## Error handling

- Missing fields → 400 `{ error: "missing_fields" }`; form shows per-field inline error.
- Email regex fails → 400 `{ error: "bad_email" }`.
- `body` > 2000 chars → 400 `{ error: "body_too_long" }`.
- `timestampSec` missing or NaN → server clamps to 0 (doesn't fail).
- Recording locked + missing/invalid unlock cookie → 403 `{ error: "locked" }`; form shows "Unlock the recording to comment."
- Rate limited → 429 `{ retryAfterSec }`; form shows "You've hit the comment rate limit. Try again in Ns."
- Mailgun call fails → logged, comment still persisted, client sees 201.
- DELETE on non-owned comment → 404 (no-leak).
- Mailgun `MAILGUN_DOMAIN` not yet verified → sends 401. Logged; comment still appears; owner will see it when they next check the share page. (Mitigated by the live-smoke prerequisite.)

---

## Testing

### Unit (`tests/unit/`)

- `comments-rate-limit.test.ts`:
  - Same hash: 3 quick `checkAndBump` calls allowed; 4th blocked with `retryAfterSec > 0`.
  - Different hashes: counts independently.
  - After advancing mocked time by 5 minutes + 1 second: allowed again.
  - LRU cap eviction: insert > 10,000 distinct hashes; oldest entries are evicted (no exception thrown, memory bounded).

- `mailgun-render.test.ts`:
  - `renderNewCommentEmail` for a vanilla input contains the commenter name, timestamp formatted `M:SS`, body, and the `#t=` deep link in both the text and html outputs.
  - Subject is ≤ 100 chars for long titles.
  - HTML output escapes `<`, `>`, `&` in the body and name (prevents injection via a crafted comment).
  - Timestamp of 125 seconds formats as `2:05`.

### Manual live smoke (after deploy)

- Owner opens `/v/V2LyopYmWS` → "Comments (0)" heading rendered; empty state message below.
- Incognito viewer:
  - Play the video, pause around 0:08.
  - Type name `Smoke`, real inbox email (one you control), body `First test comment`, submit.
  - Expect the form clears, the comment appears in the list with timestamp `[0:08]`.
- Inbox check:
  - Mail arrives from `loom-comments@mg.dissonance.cloud` with the commenter info, timestamp, body, and `<share-url>#t=8`.
  - Clicking the link opens the share page and seeks to 0:08.
- Incognito: post 3 more comments rapidly from the same window → 4th returns the rate-limit error.
- Owner: trash-icon shows on each comment; clicking one deletes it; re-refresh incognito confirms deletion.

### Skipped

- Playwright E2E — same rationale as M7/M8 (cookie + player + timing flakes in headless). Manual smoke covers it for M9; M11 ships a full-pipeline E2E.

---

## Environment

Secrets already seeded in Doppler `prd_loom` (during the M9 kickoff conversation):

- `MAILGUN_API_KEY`
- `MAILGUN_DOMAIN` — `mg.dissonance.cloud` (shared subdomain across apps on the VPS)
- `MAIL_FROM_ADDRESS` — `Loom Clone <loom-comments@mg.dissonance.cloud>`

No new dependencies required (no Mailgun SDK; direct `fetch` to the HTTP API).

---

## Risks

- **Mailgun domain not yet verified** → first send returns 401. Comment itself is unaffected because we fire-and-forget; owner sees the comment in-app. Prerequisite is flagged in testing.
- **Shared sending domain reputation** (`mg.dissonance.cloud` used by other apps) — low risk at this volume. If bounces/complaints spike, isolate with a new subdomain.
- **Rate-limiter wiped on container restart** — an attacker could schedule comments around restarts to bypass limits. Not a realistic vector at this scale; revisit if spam appears.
- **Comment body stored raw (HTML-escaped on render)** — no server-side sanitization. Acceptable because every render path escapes. Watch for leaks if a future feature renders body as HTML without escaping.
- **Commenter email stored plain in DB** — minor PII. Not displayed publicly; stored only to reach the commenter if needed. Delete-on-request is a DELETE against the comments row (no separate flow needed).
