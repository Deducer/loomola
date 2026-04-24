# M11 — Polish + Full-Pipeline E2E Smoke Design

**Milestone:** M11 (of Stage 1 — the capstone)
**Goal:** Ship an automated full-pipeline smoke test and a handful of small production-readiness polish items. No new product features.
**Companion to:** [`2026-04-22-loom-clone-design.md`](./2026-04-22-loom-clone-design.md) → overall Stage 1 contract.

---

## Scope

**In — Automated full-pipeline smoke (the main deliverable):**

- Evolve `scripts/m6-e2e-test.mjs` into `scripts/e2e-smoke.mjs`. One linear script, a `step(name, fn)` helper that prints `✓`/`✗` with timings, and a cleanup block that runs regardless of outcome.
- Exercises end-to-end:
  1. INSERT a fresh `media_objects` row pointing at an existing R2 composite.
  2. Fire Deepgram with an HMAC-signed webhook callback.
  3. Poll the DB for `status='ready'` + all AI output columns populated + `composite_thumbnail_key` set (up to 2 min).
  4. `curl` `/v/:slug`; assert viewer markup present (`<video`, `plyr`, `Transcript`).
  5. Bcrypt a test password into the row. Re-curl and assert "Password required" gate shown.
  6. POST `/v/:slug/unlock` with the password; assert 200 + `view_unlock_<slug>` Set-Cookie.
  7. With the cookie, hit `/api/v/:slug/refresh-url`; assert 200 JSON `{ url }`.
  8. POST `/api/v/:slug/comments` as a synthetic commenter; assert 201 and a matching row exists.
  9. UPDATE trim columns directly in DB. Re-curl; assert serialized `trimStartSec`/`trimEndSec` reach the HTML.
  10. Cleanup: DELETE the media_objects row (FK cascades remove ai_outputs/transcripts/comments/views). Leave the shared R2 composite in place.
- Added `"smoke": "doppler run --project dissonance-cloud --config prd_loom -- node scripts/e2e-smoke.mjs"` in `package.json`.
- `APP_URL` env var overrides the default `https://loom.dissonance.cloud` (for testing against staging or a local dev container).
- No new deps.

**In — Small production-readiness polish:**

- **Env pre-flight check** (`src/lib/env-check.ts`): a single `assertEnv()` that enumerates the critical env vars and, at first call, logs a clear `[env] missing: X, Y, Z` diagnostic if any are unset. Called eagerly at first request by key server modules so the operator sees the list in one log line rather than chasing "X is not set" errors one at a time. Does NOT gate the container boot (Doppler blips would crash-loop; graceful-on-first-miss is safer).
- **Robots / noindex on /v/:slug**: static `public/robots.txt` disallowing `/v/` and `/record`; `generateMetadata()` on `/v/[slug]/page.tsx` returns `{ robots: { index: false, follow: false } }`.
- **Log prefix normalization**: audit existing `console.log|error|warn` calls across `src/` and normalize each to `[module/kind]` — e.g., `[queue/transcribe]`, `[webhook/deepgram]`, `[comments]`, `[thumbnail]`. Pure readability; no behavior change.
- **Boot summary log**: `src/lib/boot-log.ts` exports `logBootSummaryOnce()` guarded by a module-level latch. Called at first DB use. Logs one line: `[boot] app=<APP_URL> db=<host> r2=<bucket> mailgun=<domain>`. Helps confirm a deploy picked up Doppler changes.

**Out of scope (explicit):**

- **Loom-style seek-bar drag handles for trim** — deferred per project memory; Stage 1.5 UX polish.
- **Retry UI for failed pg-boss jobs** — deferred.
- **GeoIP enrichment of `views.viewer_country`** — deferred.
- **Playwright / headless browser smoke** — the script exercises HTTP + DB directly. Browser-side UX (seek behavior, trim clamp visuals) stays manual.
- **Background R2 cleanup job for soft-deleted recordings** — deferred.
- **Sentry / external monitoring** — deferred per original spec ("revisit if pain emerges").
- **New tests on trim-validate / visitor-id / bucketize / etc.** — already covered in their respective milestones.

---

## Architecture

### Smoke script (`scripts/e2e-smoke.mjs`)

Single file. Top-level structure:

```
header: imports + env (DATABASE_URL, DEEPGRAM_*, R2_*, APP_URL)
constants: OWNER_ID, COMPOSITE_KEY, DURATION, APP_URL, TEST_PASSWORD
helpers: step(name, fn), formatMs(), wait(ms), sql client, r2 client
main:
  try:
    step "insert media_object"
    step "fire deepgram"
    step "wait for pipeline ready" (poll)
    step "curl /v/:slug (public)"
    step "set password + assert gate"
    step "unlock + capture cookie"
    step "refresh-url with cookie"
    step "post comment"
    step "set trim + assert html"
  finally:
    step "cleanup" (delete media row — FK cascades take the rest)
  print totals + exit code
```

`step(name, fn)` wraps the call in try/catch, records ms, logs `✓ name (123ms)` or `✗ name (45ms): <err>`, and rethrows on failure so the `try/finally` cleanup still runs.

### Env pre-flight (`src/lib/env-check.ts`)

Exports:
```ts
type EnvCheckResult = { ok: true } | { ok: false; missing: string[] };
export function checkEnv(): EnvCheckResult;
export function assertEnv(): void;  // logs missing once, throws on subsequent
```

Critical list:
- `DATABASE_URL`
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`
- `DEEPGRAM_API_KEY`, `DEEPGRAM_CALLBACK_SIGNING_SECRET`
- `ANTHROPIC_API_KEY`, `LLM_MODEL_ID`
- `VIEW_UNLOCK_SECRET`, `VISITOR_HASH_SALT`
- `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `MAIL_FROM_ADDRESS`
- `NEXT_PUBLIC_APP_URL`

Integration points: `src/lib/boot-log.ts` calls `checkEnv()` and emits the missing list alongside the boot summary. Individual factories (R2 client, Deepgram client, etc.) already throw their own per-var errors — this is additive.

### Robots / noindex

- `public/robots.txt`:
```
User-agent: *
Disallow: /v/
Disallow: /record
Disallow: /api/
Allow: /
```
- `src/app/v/[slug]/page.tsx`: add `generateMetadata()` returning `{ robots: { index: false, follow: false } }`. Applies to every share page.

### Log prefix audit

Files to touch (grep will confirm):
- `src/lib/queue/boss.ts` — already `[pg-boss] ...`
- `src/lib/queue/jobs/*.ts` — already `[title-summary]`, `[chapters]`, etc.
- `src/app/api/webhooks/deepgram/[...]/route.ts` — already `[webhook/deepgram]`
- `src/app/api/v/[slug]/comments/route.ts` — has `[comments]` already
- A few scattered `console.log` / `console.error` without prefixes — normalize to match.

### Boot summary

```ts
// src/lib/boot-log.ts
let logged = false;
export function logBootSummaryOnce(): void {
  if (logged) return;
  logged = true;
  const { ok, missing } = checkEnv();
  const host = (process.env.DATABASE_URL ?? "").match(/@([^:]+)/)?.[1] ?? "?";
  const bucket = process.env.R2_BUCKET_NAME ?? "?";
  const mg = process.env.MAILGUN_DOMAIN ?? "?";
  const app = process.env.NEXT_PUBLIC_APP_URL ?? "?";
  console.log(
    `[boot] app=${app} db=${host} r2=${bucket} mailgun=${mg}` +
    (ok ? "" : ` missingEnv=[${missing.join(",")}]`)
  );
}
```

Called from `src/db/index.ts` at first DB use.

### Package.json

```json
"scripts": {
  ...
  "smoke": "doppler run --project dissonance-cloud --config prd_loom -- node scripts/e2e-smoke.mjs"
}
```

---

## Data flow

**Smoke test happy path:**

1. Script starts — reads env via Doppler-injected vars.
2. INSERT media_objects → note `mediaId` + `slug`.
3. Sign R2 GET for `iMoZLHX7CF/composite.webm`. Fire Deepgram with callback to `${APP_URL}/api/webhooks/deepgram/${mediaId}/${hmac}`.
4. Deepgram → transcribe → webhook → pg-boss fan-out → 4 jobs run.
5. Script polls DB every 3s until status='ready' + all AI outputs set. If 2 min elapses without readiness, the step fails and the catch block dumps the last pg-boss job states for the script's media_object before cleanup.
6. On success, curl the viewer page (no cookie) → assert viewer is rendered.
7. Set `password_hash` via direct UPDATE. Curl → assert gate renders.
8. POST unlock → assert 200 + cookie extracted.
9. With the cookie, GET `/api/v/:slug/refresh-url` → assert 200 + URL.
10. POST comment → assert 201 and that the DB has a matching row.
11. UPDATE `trim_start_sec`/`trim_end_sec` directly. Curl → assert `trimStartSec` appears in the HTML.
12. Cleanup: DELETE media_objects row (cascades).
13. Print summary + exit 0.

**Boot summary:**

1. Container starts, app boots, first HTTP request arrives.
2. Route handler hits DB → `getDb()` → calls `logBootSummaryOnce()` (inside the DB module's lazy init block).
3. `checkEnv()` runs, missing list computed.
4. Single `[boot] ...` line emitted to stdout (Coolify captures it).
5. `logged = true`; subsequent calls are no-op.

---

## Error handling

- Smoke: any step throws → `✗` log with error → run cleanup → exit 1. Cleanup deletes any media row created in step 2 (whether it succeeded or not, via a shared `mediaId` variable).
- Smoke timeout (step 3 wait) → explicit message like `pipeline never reached ready (status=processing; last_pg_boss_states=...)`.
- Env-check missing vars → logged but non-fatal. Existing per-var errors already exit the specific request; this is purely diagnostic.
- Robots.txt edit → static file, no failure mode.
- Boot log → if anything in `checkEnv()` or masking throws, catches internally and emits a reduced log instead of failing startup.

---

## Testing

- Unit: none new.
- Live smoke: `npm run smoke` once after deploy completes. Expected: all ✓ lines, exit 0, < 90s total.
- Boot log: verify the next Coolify deploy's startup logs contain exactly one `[boot] ...` line.

---

## Environment

No new secrets. No new runtime dependencies. `scripts/e2e-smoke.mjs` reuses existing imports from the project's `node_modules`.

---

## Risks

- **Rate limit interaction in the smoke test**: repeated runs from the same machine will accumulate comment rate-limit state (3/5min per visitor hash). The smoke script posts one comment per run, so 3 back-to-back runs is the ceiling before a 429. Acceptable — note this in the script's top-of-file comment.
- **Deepgram cost per run**: each run transcribes a 12s clip (~$0.01 at current rates). Not a concern.
- **Boot log prints DB host at INFO**: the host is already derivable from DATABASE_URL env injection and never leaves the container stdout. Not a secret.
- **Env pre-flight listing all 19 critical vars**: if the list grows unwieldy, group by feature area. Not a near-term concern.
