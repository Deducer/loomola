# Security Hardening Pack

**Author:** Claude Opus 4.7
**Date:** 2026-05-04
**Status:** Spec'd, ready to plan + build
**Related plan:** [`docs/superpowers/plans/2026-05-04-security-hardening-pack.md`](../plans/2026-05-04-security-hardening-pack.md)

---

## Why now

The product has reached "feels paid" on most surfaces. The remaining security gaps are not currently exploitable in any serious way for a single-user product, but they fall short of what a paid SaaS would ship. They're also cheap to close — total estimated effort is 4–6 hours, mostly small middleware and signing-key changes. Closing them removes a class of failure modes (XSS exfiltration, replay attacks, MIME-sniff RCE, ephemeral rate-limit bypass) and gets the app to a posture that survives a first-pass external review without flinching.

Five concrete items, in order of leverage:

1. **HTTP security headers** (CSP, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `Strict-Transport-Security`) — currently absent, add via Next.js middleware.
2. **Time-bound unlock cookies** for password-protected share pages — token currently has no expiry baked into the signature.
3. **Body- and time-bound HMAC signing** for the Deepgram callback webhook — current signature only covers `recordingId`.
4. **Persistent comment rate-limit storage** — currently in-process JS object; lost on every restart.
5. **Desktop app Keychain-only token storage** — currently falls back to a plaintext file in any non-Bundle-path environment.

Doing these as a pack (one PR) keeps the diff coherent and the testing scope tight.

## Goals

- A future external auditor (or `/security-review`) finds no missing baseline HTTP security headers.
- An unlock cookie has a server-enforced 24-hour expiry; no token signed today still works in 30 days even if the password hasn't changed.
- A captured Deepgram callback signature cannot be replayed against a different body or after a 5-minute timestamp window.
- Comment rate limits survive deployments and process restarts.
- The desktop app stores Supabase session material only in macOS Keychain, never in a plaintext file, regardless of the binary path.
- All changes ship without breaking the existing smoke E2E (`npm run smoke`).

## Non-goals

- Full WAF / DDoS protection (Coolify + Traefik + Cloudflare upstream is sufficient for current scale).
- Multi-tenant authorization model.
- 2FA on the creator account (single-user product; deferred until multi-tenant lands).
- Rotating signing keys (single-key model is fine for now; key rotation is a separate sprint).
- Subresource integrity hashes for CDN-loaded fonts/scripts (Google Fonts injection on share pages — defer; see open question).
- Audit logging or anomaly detection.
- Penetration test or third-party review.

---

## Items

### 1. HTTP security headers

**Current state:** `next.config.ts` has zero security headers. No CSP, no `X-Content-Type-Options`, no `Referrer-Policy`, no `Permissions-Policy`, no `Strict-Transport-Security`. The site relies on Traefik's defaults (which do set HSTS but nothing else).

**Target state:** all common headers set via Next.js middleware, with values tuned for the app's actual external dependencies (Google Fonts on share pages, R2 signed URLs for media, Plyr from npm, Mailgun nowhere in the front-end).

**CSP draft (refine during implementation):**

```
default-src 'self';
script-src 'self' 'unsafe-inline';
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src 'self' https://fonts.gstatic.com data:;
img-src 'self' https: data: blob:;
media-src 'self' https://*.r2.cloudflarestorage.com blob:;
connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.r2.cloudflarestorage.com;
worker-src 'self' blob:;
frame-src 'self' https://loom.dissonance.cloud;
frame-ancestors 'self';
base-uri 'self';
form-action 'self';
object-src 'none';
upgrade-insecure-requests;
```

`'unsafe-inline'` for `script-src` is needed during M2-era because of the inline theme-bootstrap script on share pages and various small inlined Next.js bootstraps. A nonce-based CSP is the right long-term fix; add a TODO. `'unsafe-inline'` on `style-src` is realistic for Tailwind's runtime + Plyr's inline styles; tightening is a separate sprint.

**Other headers:**

- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` (2 years; preload-eligible).
- `X-Content-Type-Options: nosniff`.
- `Referrer-Policy: strict-origin-when-cross-origin`.
- `Permissions-Policy: camera=(self), microphone=(self), display-capture=(self), geolocation=(), interest-cohort=()`.
- `X-Frame-Options: SAMEORIGIN` (legacy companion to `frame-ancestors 'self'`).

**Implementation:** new `src/middleware.ts` augmentation (or a dedicated `src/lib/security/headers.ts` invoked from middleware) that sets these on every response. Special-case the `/bubble` route — it's loaded into a cross-origin iframe by the Chrome extension on every tab — needs `frame-ancestors *` (or scoped to the extension's chrome-extension:// origin) to keep working.

**Verification:** `curl -I https://loom.dissonance.cloud/` shows all expected headers. `curl -I https://loom.dissonance.cloud/bubble` has the relaxed `frame-ancestors`.

### 2. Time-bound unlock cookies

**Current state:** `src/lib/viewer/unlock-cookie.ts` signs `${slug}:${passwordHash}` with HMAC-SHA256. Cookie has a 24-hour `maxAge` set by the browser, but the token itself never expires server-side. A leaked token (browser history, shared URL, proxy log) remains valid forever as long as the password isn't changed.

**Target state:** signed token includes an `issuedAt` timestamp; verifier rejects tokens older than 24 hours.

**Token format change:**

```
const issuedAt = Date.now();
const tokenPayload = `${slug}:${passwordHash}:${issuedAt}`;
const sig = HMAC(tokenPayload);
const token = `${issuedAt}.${sig}`;
```

Verifier:

1. Parses `[issuedAt, sig]` from token.
2. Checks `Date.now() - issuedAt < 24 * 3600 * 1000`.
3. Recomputes signature over `slug:passwordHash:issuedAt` and `timingSafeEqual` against `sig`.
4. Returns `false` on any failure.

**Migration:** existing cookies will fail to verify after deploy and the user will be re-prompted for the password. Acceptable — single-user product, low cost. Document in plan.

**Implementation:** edit `src/lib/viewer/unlock-cookie.ts`. Add unit tests for: valid recent token, expired token, tampered timestamp, tampered signature.

### 3. Body- and time-bound Deepgram callback HMAC

**Current state:** `src/lib/deepgram/callback-signature.ts` HMAC-signs only `recordingId`. The webhook URL embeds the signature; a captured signature is replayable forever, and an attacker who learns one signature can deliver a forged transcript body to that recording's webhook. Body integrity is unverified.

**Target state:** signature covers `recordingId + ":" + issuedAt + ":" + sha256(body)`, with a 5-minute timestamp window enforced by the verifier.

**Wrinkle:** the signature is in the URL path (`/api/webhooks/deepgram/[recordingId]/[sig]/route.ts`), and Deepgram POSTs to that URL with the transcript JSON in the body. The signature is computed *before* we make the callback URL — so we can't cover the body in the signature. Two options:

1. **Sign a one-time nonce instead of `recordingId`.** Persist `(recordingId, nonce, issuedAt, expectedBodyHash?)` in the database when we kick off the Deepgram job. Verifier looks up the nonce; if it's already been used or expired, reject. This is the right fix.

2. **Add a per-job HMAC of the response body.** Deepgram supports custom headers on callbacks; we can't dictate signature-of-body, but we can include a job-specific HMAC key in the URL and require Deepgram to echo a known field that we use as a nonce. More fragile.

**Decision:** option 1. Add a `webhook_nonces` table:

```sql
CREATE TABLE webhook_nonces (
  nonce text PRIMARY KEY,
  recording_id uuid NOT NULL REFERENCES media_objects(id) ON DELETE CASCADE,
  provider text NOT NULL,                  -- 'deepgram'
  issued_at timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz,
  expires_at timestamptz NOT NULL          -- now() + interval '24 hours'
);
CREATE INDEX ON webhook_nonces (recording_id);
```

Workflow:

1. When enqueueing a Deepgram job for a recording, generate `nonce = randomBytes(32).hex()`, insert a row with `expires_at = now() + 24h`.
2. Sign callback URL as `recording_id/nonce` (HMAC kept for tamper-resistance against URL guesses).
3. Verifier checks: HMAC matches → nonce row exists, not consumed, not expired → mark consumed → process body.

**Implementation:** new migration, edit `src/lib/deepgram/callback-signature.ts`, edit `src/app/api/webhooks/deepgram/[recordingId]/[sig]/route.ts`, edit Deepgram job enqueue path. Tests: valid nonce passes once, second attempt fails, expired nonce fails, mismatched HMAC fails.

**Migration risk:** if Coolify deploys the new code while a Deepgram job is in flight from the old code, the callback will fail (no nonce row). Acceptable — Deepgram retries; on retry the new path won't have a nonce either, so the recording will appear "stuck transcribing." Mitigation: re-trigger transcription for any in-flight recording after deploy via an admin script (or accept the loss for a single-user system).

### 4. Persistent comment rate-limit storage

**Current state:** `src/lib/comments/rate-limit.ts` (per agent report) maintains a JavaScript Map in module scope. Service restart wipes it. Doesn't survive horizontal scale. Three-per-five-minute limit is bypassable by any deploy or crash.

**Target state:** rate limit state persisted in Postgres, keyed by visitor hash + endpoint.

**Schema:**

```sql
CREATE TABLE rate_limits (
  scope text NOT NULL,                     -- e.g. 'comments:visitor'
  key text NOT NULL,                       -- the visitor hash
  events jsonb NOT NULL DEFAULT '[]',      -- array of timestamptz
  PRIMARY KEY (scope, key)
);
```

Or simpler: a `rate_limit_events` insert-only table with `(scope, key, occurred_at)` and a window-count query. Insert-only is cleaner; cleanup is a single `DELETE WHERE occurred_at < now() - interval '1 hour'` running on a pg-boss cron.

**Decision:** insert-only table, `scope` and `key` indexed. Cleanup job runs hourly.

**Implementation:** new migration, edit `src/lib/comments/rate-limit.ts` to query/insert from the table. Add a generic helper `checkRateLimit({ scope, key, max, windowSec })` so future endpoints (password unlock attempts, login attempts, future Q&A endpoints) can reuse it.

**Bonus:** while we're here, add a rate limit on password-unlock attempts on `/v/:slug` (currently unlimited) — 5 attempts per visitor hash per 5 minutes is the standard.

### 5. Desktop app Keychain-only token storage

**Current state:** `desktop/Sources/LoomDesktopApp/Auth/AuthSessionStore.swift:145` switches to a JSON file under `~/Library/Application Support/LoomDesktop/auth-session.json` (mode 0o600) when the bundle path contains `.build/`. Fine for dev but the path is too easy to hit by accident — any unsigned local build, any release tarball that doesn't get signed before distribution, falls into the file path.

**Target state:** Keychain only. The file path is removed entirely. If Keychain access fails (rare — usually means the user denied a prompt), the app prompts the user to grant access or sign in again; it does not silently fall back to plaintext.

**Implementation:** edit `desktop/Sources/LoomDesktopApp/Auth/AuthSessionStore.swift`, remove the file-store branch and `usesFileStore` heuristic. Update tests. Verify dev flow still works on Ian's M4 Pro.

**Risk:** dev unsigned builds may now require granting Keychain access on every launch (Keychain ACLs are tied to code signature). Mitigation: sign the dev build with an ad-hoc identity (`codesign -s - desktop/.build/...`); the Keychain entry then has a stable ACL and the prompt only fires once. Document in `desktop/README.md`.

---

## Acceptance criteria

- `curl -I https://loom.dissonance.cloud/` returns CSP, HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`.
- `curl -I https://loom.dissonance.cloud/bubble` returns the same with `frame-ancestors` set to allow the Chrome extension origin (or `*`, scoped explicitly in the CSP for that route).
- Manual test: a token issued > 24 h ago fails verification (forge timestamp in test).
- Smoke E2E (`npm run smoke`) passes end-to-end after the Deepgram webhook nonce flow lands.
- `tests/unit/comments-rate-limit.test.ts` (new) covers: rate limit persists across simulated process restart.
- Comment rate limit test against live deploy: 4 comments in 5 minutes from one fingerprint → 4th rejected.
- Desktop app on Ian's M4 Pro: signing in stores tokens in Keychain (verifiable via `security find-generic-password -s cloud.dissonance.loom.desktop`); no `auth-session.json` file written under any path.
- All security-related unit tests pass; no regressions in other test suites.

## Verification

- Run `/security-review` after the PR lands and confirm the four critical / high items in the original review (plaintext token, missing CSP, no unlock expiry, no webhook replay protection) are gone.
- Run an external SSL-Labs-style check (`https://securityheaders.com/?q=loom.dissonance.cloud`) and confirm A grade or better.

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| CSP breaks the share page (Google Fonts injection, Plyr inline styles) | Visible regression for the most polished surface | Test on staging branch; add `'unsafe-inline'` to style-src; tighten in a follow-up |
| Deepgram in-flight jobs at deploy time | "Stuck transcribing" cards | Manual re-trigger script for any in-flight recording immediately after deploy |
| Keychain ACL change breaks unsigned dev builds | Dev friction; auth prompts on every launch | Document ad-hoc signing in desktop README |
| 24h unlock cookie expiry forces re-entry | Visitor friction on a long-running share session | Acceptable for security; tune to 7 days if Ian prefers |
| Rate-limit Postgres queries add latency to comment posts | Marginal — single SELECT + INSERT | Use partial index on `(scope, key, occurred_at DESC)`; profile in production |
| Bubble CSP breakage with Chrome extension | Bubble iframe stops loading in tabs | Carefully scope `frame-ancestors` for `/bubble` route only; manual smoke after deploy |

## Out of scope

- Nonce-based CSP (kills `'unsafe-inline'`). Tracked as a follow-up.
- Subresource integrity for Google Fonts / Plyr.
- Login attempt rate limit on the creator account (Supabase Auth already handles this).
- 2FA.
- Audit logging.
- Multi-tenant authorization changes.
- Webhook signing key rotation infrastructure.
