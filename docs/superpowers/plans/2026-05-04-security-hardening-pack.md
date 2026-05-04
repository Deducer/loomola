# Security Hardening Pack — Implementation Plan

**Date:** 2026-05-04
**Spec:** [`docs/superpowers/specs/2026-05-04-security-hardening-pack-design.md`](../specs/2026-05-04-security-hardening-pack-design.md)
**Status:** Ready to execute
**Style:** TDD-flavoured, one small slice at a time. Single PR.

Five items, in dependency order. Items 1, 4, 5 are independent and can land in any order. Items 2 and 3 each touch real signing/webhook code paths and want their own commits. Total estimate 4–6 hours of focused work.

---

## Phase 1 — HTTP security headers (~30 min)

### 1. Add `src/lib/security/headers.ts`

- **File:** new `src/lib/security/headers.ts`.
- **Goal:** export `applySecurityHeaders(response: NextResponse, opts?: { allowFraming?: boolean })` that sets the headers from the spec. The `allowFraming` flag relaxes `frame-ancestors` and drops `X-Frame-Options` for the `/bubble` route only.
- **Sketch:**
  ```ts
  export function applySecurityHeaders(
    res: NextResponse,
    opts: { allowFraming?: boolean } = {}
  ): NextResponse {
    res.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
    res.headers.set("X-Content-Type-Options", "nosniff");
    res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    res.headers.set("Permissions-Policy", "camera=(self), microphone=(self), display-capture=(self), geolocation=(), interest-cohort=()");
    if (!opts.allowFraming) {
      res.headers.set("X-Frame-Options", "SAMEORIGIN");
    }
    res.headers.set("Content-Security-Policy", buildCSP({ allowFraming: opts.allowFraming }));
    return res;
  }
  ```
- **Tests:** `tests/unit/security-headers.test.ts` — verify each expected header is present, verify `allowFraming` swap.

### 2. Wire into `src/middleware.ts`

- **File:** edit existing `src/middleware.ts` (or create if missing — verify via Read first).
- **Goal:** call `applySecurityHeaders(response)` for all matched routes, with `allowFraming: true` for `/bubble`.
- **Sketch:**
  ```ts
  export function middleware(req: NextRequest) {
    const res = NextResponse.next();
    applySecurityHeaders(res, { allowFraming: req.nextUrl.pathname === "/bubble" });
    return res;
  }
  export const config = { matcher: ["/((?!_next/static|favicon.ico).*)"] };
  ```
- **Acceptance:** `npm run dev` then `curl -I http://localhost:3000/` shows all headers. `curl -I http://localhost:3000/bubble` shows the relaxed framing.
- **Smoke:** load the share page, the dashboard, the edit page — no console CSP violations. If violations show up for inline styles, add the offending hash or relax `style-src` (add `'unsafe-inline'` if not already there).

### 3. Manual share-page smoke

- **Goal:** load `/v/:slug` for a known recording, confirm:
  - Plyr renders with no console errors.
  - Google Font (brand profile) loads.
  - Hover-scrub thumbnails work.
  - Comments post.
  - Bubble iframe (Chrome extension) still injects on a non-loom tab.
- **Acceptance:** all five surfaces work; no CSP violations in the browser console.

---

## Phase 2 — Time-bound unlock cookies (~20 min)

### 4. Update `src/lib/viewer/unlock-cookie.ts` token format

- **File:** edit `src/lib/viewer/unlock-cookie.ts`.
- **Changes:**
  - `signUnlockToken({ slug, passwordHash })` now signs `slug:passwordHash:issuedAt` and returns `${issuedAt}.${sig}`.
  - `verifyUnlockToken({ slug, passwordHash, token })` parses `[issuedAt, sig]`, rejects if `Date.now() - issuedAt > 24 * 3600 * 1000`, then re-signs over `slug:passwordHash:issuedAt` and `timingSafeEqual`s.
- **Tests:** `tests/unit/unlock-cookie.test.ts` (new):
  - Valid recent token passes.
  - Token signed > 24 h ago is rejected.
  - Token with tampered timestamp is rejected.
  - Token with tampered signature is rejected.
  - Token issued before a password change is rejected (passwordHash differs in signing).
- **Acceptance:** all tests pass; existing flow ((`/v/:slug/unlock` POST) still issues + reads cookies correctly.

### 5. Note in PR description

- **Note:** existing visitor cookies will fail to verify after deploy and visitors will be re-prompted once. Acceptable.

---

## Phase 3 — Deepgram callback nonce (~90 min)

### 6. Migration: `webhook_nonces` table

- **File:** new `drizzle/<NNNN>_webhook_nonces.sql` (use the next number; check `drizzle/meta/_journal.json` for current high water mark).
- **Schema:** see spec § 3 (`webhook_nonces` table with `nonce`, `recording_id`, `provider`, `issued_at`, `consumed_at`, `expires_at`, indexed by `recording_id`).
- **Acceptance:** migration runs cleanly via `scripts/migrate.ts`; `_journal.json` updated.

### 7. Update Drizzle schema

- **File:** edit `src/db/schema.ts` (or whichever schema file owns it — verify).
- **Goal:** add the `webhookNonces` table to the Drizzle schema for type-safe inserts/selects.
- **Acceptance:** `npm run typecheck` passes.

### 8. Update `signRecordingId` → `issueDeepgramCallbackToken`

- **File:** edit `src/lib/deepgram/callback-signature.ts`.
- **Changes:**
  - New `issueDeepgramCallbackToken(recordingId)` — generates a 32-byte hex nonce, inserts a row into `webhook_nonces`, returns `{ nonce, sig }` where `sig = HMAC(recordingId + ":" + nonce)`.
  - Replace `verifyRecordingSignature(recordingId, sig)` with `verifyAndConsumeCallbackToken(recordingId, nonce, sig)` — verifies HMAC, then atomically `UPDATE webhook_nonces SET consumed_at = now() WHERE nonce = ? AND consumed_at IS NULL AND expires_at > now() RETURNING *`. Returns true only if the update returned a row.
- **Tests:** `tests/unit/deepgram-callback-signature.test.ts`:
  - Valid nonce + sig: first attempt succeeds, second attempt fails (already consumed).
  - Expired nonce fails.
  - Tampered sig fails.
  - Wrong recordingId fails.

### 9. Update Deepgram job enqueue path

- **File:** find the call site of `signRecordingId` for outgoing webhook URL construction (likely `src/lib/jobs/transcribe.ts` or `src/lib/deepgram/client.ts`). Read first, then edit.
- **Goal:** call `issueDeepgramCallbackToken(recordingId)` and embed `${nonce}/${sig}` (or whatever shape the existing route expects) in the callback URL.
- **Note:** the route's URL pattern is `[recordingId]/[sig]` — needs to extend to `[recordingId]/[nonce]/[sig]`. Update the route file too.

### 10. Update `[recordingId]/[sig]` → `[recordingId]/[nonce]/[sig]` route

- **File:** rename `src/app/api/webhooks/deepgram/[recordingId]/[sig]/route.ts` → `src/app/api/webhooks/deepgram/[recordingId]/[nonce]/[sig]/route.ts`. Update imports.
- **Goal:** parse the new path params; call `verifyAndConsumeCallbackToken(recordingId, nonce, sig)`; reject 401 on failure.
- **Acceptance:** smoke test via `npm run smoke` confirms transcript flow still works end-to-end. Deepgram callback succeeds, transcript persists, AI jobs fan out.

### 11. Backfill / cleanup script note

- **File:** edit `scripts/migrate.ts` or add a one-off `scripts/retrigger-stuck-transcripts.ts`.
- **Goal:** for any `media_objects` in transcribing-state with no `transcripts` row > 5 min, re-enqueue Deepgram. Document running this once after deploy.
- **Acceptance:** documented in PR description; no automation required for v1.

---

## Phase 4 — Persistent comment rate limit (~45 min)

### 12. Migration: `rate_limit_events` table

- **File:** new `drizzle/<NNNN>_rate_limit_events.sql`.
- **Schema:**
  ```sql
  CREATE TABLE rate_limit_events (
    id bigserial PRIMARY KEY,
    scope text NOT NULL,
    key text NOT NULL,
    occurred_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX rate_limit_events_scope_key_occurred_at_idx
    ON rate_limit_events (scope, key, occurred_at DESC);
  ```
- **Acceptance:** runs cleanly.

### 13. Drizzle schema update

- **File:** edit `src/db/schema.ts`.
- **Acceptance:** typecheck passes.

### 14. Generic `checkRateLimit` helper

- **File:** new `src/lib/rate-limit/check.ts`.
- **Goal:** export `async function checkRateLimit({ scope, key, max, windowSec }): Promise<boolean>` — counts events in window, inserts a new event if under cap, returns `true` if allowed (and inserted), `false` if blocked. Uses a single `INSERT ... SELECT ... WHERE (count) < max` to make the check + insert atomic, OR uses a serializable transaction.
- **Tests:** `tests/unit/rate-limit.test.ts`:
  - Under cap → allowed; over cap → blocked.
  - Events outside window not counted.
  - Different keys / scopes don't interfere.
  - Concurrent calls don't double-allow (use a transaction or `INSERT ... WHERE NOT EXISTS`-style check; document the chosen consistency model).

### 15. Replace in-memory `rate-limit.ts`

- **File:** edit `src/lib/comments/rate-limit.ts` (read first to confirm path/exports).
- **Goal:** delegate to `checkRateLimit({ scope: "comments:visitor", key: visitorHash, max: 3, windowSec: 300 })`.
- **Acceptance:** comment-post tests still pass; smoke covers it.

### 16. Add password-unlock rate limit (bonus)

- **File:** edit `src/app/v/[slug]/unlock/route.ts` (or wherever the POST handler is).
- **Goal:** wrap with `checkRateLimit({ scope: "unlock:visitor", key: visitorHash, max: 5, windowSec: 300 })`. On block, return 429 with a Retry-After.
- **Acceptance:** manual test — 6 wrong passwords in 5 minutes → 429.

### 17. Cleanup cron

- **File:** edit pg-boss queue setup (search for `getBoss` + queue registration; likely in `src/lib/queue/*` or a startup file).
- **Goal:** add an hourly cron `cleanup_rate_limits` that runs `DELETE FROM rate_limit_events WHERE occurred_at < now() - interval '1 hour'`.
- **Acceptance:** deployed; verify table doesn't grow unboundedly via a SQL count check after 24 h.

---

## Phase 5 — Desktop app Keychain-only token storage (~30 min)

### 18. Remove file-store fallback in `AuthSessionStore.swift`

- **File:** edit `desktop/Sources/LoomDesktopApp/Auth/AuthSessionStore.swift`.
- **Changes:**
  - Delete the `usesFileStore` heuristic (the `Bundle.main.bundlePath.contains("/.build/")` check).
  - Delete the file-write/read code paths.
  - Make `KeychainSessionStore` the only implementation.
  - On Keychain access failure, surface a clear error to the UI ("Couldn't access Keychain — sign in again or grant access in System Settings → Privacy → Keychain"), do NOT fall back to plaintext.
- **Acceptance:** `desktop/Tests/LoomDesktopTests/AuthSessionStoreTests.swift` no longer references file-store; sign-in flow still works on Ian's M4 Pro.

### 19. Document ad-hoc signing for dev builds

- **File:** edit `desktop/README.md`.
- **Goal:** add a section "Why Keychain prompts you on each unsigned build" explaining ACL behavior + the workaround:
  ```
  codesign -s - --force --deep .build/debug/LoomDesktop.app
  ```
- **Acceptance:** Ian can run dev build with one Keychain prompt instead of one per launch.

---

## Phase 6 — Verification

### 20. Smoke E2E

- **Run:** `npm run smoke`.
- **Acceptance:** passes end-to-end (transcribe → AI → viewer → unlock → comment → trim → cleanup).

### 21. Headers + securityheaders.com check

- **Run:** `curl -I https://loom.dissonance.cloud/` after deploy. `curl -I https://loom.dissonance.cloud/bubble` after deploy.
- **External:** `curl https://securityheaders.com/?q=loom.dissonance.cloud&followRedirects=on` (or visit in browser).
- **Acceptance:** A grade or better. All headers from the spec present.

### 22. Run `/security-review`

- **Goal:** confirm the four high-impact items from the original review are now clean.

### 23. Update CLAUDE.md + AGENTS.md + ROADMAP.md

- **Files:** `CLAUDE.md`, `AGENTS.md`, `ROADMAP.md`.
- **Goal:** mark security pack shipped; remove "no CSP / nosniff / referrer policy" from the known-gaps list.

---

## Build notes for the next agent

- **Order of phases.** Phases 1, 4, 5 are independent. Phase 2 (unlock cookie) is independent. Phase 3 (Deepgram nonce) is the most invasive — leave it for last so the rest is shipped before any webhook code is touched.
- **CSP triage strategy.** If the CSP breaks something in dev, do not loosen the policy globally — find the specific offender and either move inline content out, or hash + add to `script-src`/`style-src`. The one production exception worth keeping is `'unsafe-inline'` on `style-src` (Tailwind + Plyr inline styles).
- **`/bubble` is special.** It is loaded into a cross-origin iframe by the Chrome extension on every tab. `frame-ancestors` for that route alone needs to allow the extension origin (or `*` if scoping to chrome-extension:// gets ugly). Verify the extension still works after deploy.
- **The pre-existing `tests/unit/ai-schemas.test.ts > rejects negative timestamps` failure is unrelated.** Don't touch it.
- **Phase 3 risks an incident.** Anyone with an in-flight Deepgram job at deploy time will have their transcript fail. Time the deploy for off-hours; verify no jobs in flight via `pg-boss` queue inspection before pushing.
- **Don't add audit logging in this PR.** It's tempting; defer it.
- **Don't add 2FA in this PR.** Same answer.
- **Don't rotate signing keys in this PR.** Single-key model is fine; rotation is its own sprint.

---

## Out of scope

- Nonce-based CSP (kills `'unsafe-inline'` on `script-src`).
- Subresource integrity for fonts / Plyr.
- 2FA / MFA on the creator account.
- Login rate limit (Supabase Auth handles).
- Audit logging.
- Multi-tenant authorization model.
- Webhook signing key rotation.
