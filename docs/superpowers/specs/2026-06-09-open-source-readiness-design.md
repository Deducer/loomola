# Open-Source Readiness — Loomola v1.0 Design

**Date:** 2026-06-09
**Status:** Approved by Ian (scope questions answered 2026-06-09)
**Goal:** Turn Loomola from "Ian's daily driver that happens to be public" into a premium, easily self-hostable open-source product on par with the paid SaaS alternatives (Loom, Granola) and the leading OSS comparable (Cap).

## Acceptance test (the bar)

A technically-competent stranger — concretely: Ian's friend Abb, on a recorded live call where Ian does **not** intervene — clones the repo and gets from zero to a working instance (first recording transcribed, titled, and shareable) in under 30 minutes, using only the repo's documentation. The running instance must then not silently break: container restarts don't kill background jobs, failures show up in the UI with a retry path, and a health endpoint reports real status.

## Scope decisions (locked)

| Decision | Choice |
|---|---|
| Supabase | **Stays the one required external account.** It provides both auth and Postgres; `auth.users` FKs mean the DB must be Supabase's Postgres (cloud free tier, or self-hosted Supabase as a documented advanced path). No auth rewrite in v1. |
| Accounts | **First-run in-app admin setup + password reset + invite-based multi-user.** No open signup by default. |
| Repo cleanup | **Forward-only.** Untrack problematic files; no git history rewrite (Coolify deploy hooks and clones stay intact). |
| Distribution | All four: docker-compose + generic S3/MinIO, configurable Chrome extension, notarized desktop releases via CI, pluggable transcription (Whisper). |

## Current-state findings driving the design

From the 2026-06-09 codebase audit:

- Dockerfile ENTRYPOINT hard-requires Doppler; no docker-compose exists.
- S3 endpoint is constructed as `https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com` in `src/lib/r2/client.ts` — MinIO/AWS S3 cannot work without a code change. CSP `media-src` hardcodes `*.r2.cloudflarestorage.com`.
- CSP `frame-src` hardcodes `https://loom.dissonance.cloud` (`src/lib/security/headers.ts`); `/api/contact` fallback message references @theiancross; migration page falls back to Ian's domain.
- No signup of any kind: first user is created manually in the Supabase dashboard.
- `src/lib/env-check.ts` lists Mailgun/Anthropic as CRITICAL but is log-only; missing env vars crash lazily deep inside jobs/requests.
- pg-boss boot-warm (`src/instrumentation.ts`) was reverted after the 2026-05-06 outage (webpack tried to bundle `pg`); workers are dead after every container restart until something enqueues. `scripts/wake-prod-boss.mjs` is the undiscoverable workaround.
- `/api/health` returns a static ok — no DB, queue-depth, or worker checks.
- Browser part uploads (`src/lib/recording/upload-coordinator.ts`) have zero retry; one transient network error loses the recording.
- Failed/stuck AI pipeline leaves recordings in `transcribing`/`processing` forever; no `failed` propagation, no retry UI. Incident scripts (`requeue-ai-jobs.mjs` etc.) are the only recovery.
- `TRANSCRIBE_PROVIDER` is documented in `.env.example` but never read; Deepgram is hardcoded.
- Chrome extension hardcodes `loom.dissonance.cloud` in `manifest.json`, `background.js`, `popup.html`.
- MCP owner resolution silently falls back to the oldest `auth.users` row.
- Repo tracks 27 copyrighted Granola UI screenshots (`docs/Granola UI Screenshots/`) and `.claude/settings.local.json` (contains an Anthropic env ID).
- No CONTRIBUTING/SECURITY/issue templates/ESLint; CI runs typecheck + unit tests only (no lint, no build); package.json version stale at 0.0.1 with one old tag.
- Positive baseline to preserve: AGPL-3.0, strong README quickstart, strict TS, owner-scoped queries + RLS defense-in-depth, 247 passing unit tests, 96 desktop tests.

## Phase 1 — One-command self-host

**1.1 Doppler-optional container.** New `docker-entrypoint.sh`: if `DOPPLER_TOKEN` is set, exec `doppler run -- "$@"`; else exec directly. Dockerfile CMD unchanged in substance (`migrate && server.js`). Ian's Coolify deploy keeps working with zero config change.

**1.2 docker-compose.yml.** Services: `app` (GHCR image by default, `build: .` override documented), `minio`, `minio-init` (creates bucket + CORS on first boot). Supabase + Deepgram + LLM keys come from a single `.env` file (`.env.compose.example` template). A `docker-compose.override.r2.yml`-style profile (or documented env-only path) for users on real R2 with no MinIO. App service gets a healthcheck against `/api/health`.

**1.3 Generic S3 endpoint.** Optional `S3_ENDPOINT` env var; when set, used verbatim (with `S3_FORCE_PATH_STYLE=true` support for MinIO); when unset, falls back to the existing R2 construction. CSP `media-src`/`connect-src` derive the storage origin from the resolved endpoint instead of the hardcoded wildcard. Existing `R2_*` var names stay (no rename churn); docs explain they mean "your S3-compatible store."

**1.4 Env contract + fail-fast + doctor.** Restructure `src/lib/env-check.ts` into a declarative contract: `core` (DATABASE_URL, Supabase trio, storage, secrets, NEXT_PUBLIC_APP_URL), `feature: transcription` (provider-dependent), `feature: ai` (ANTHROPIC_API_KEY or OPENROUTER_API_KEY), `feature: email` (Mailgun trio — now genuinely optional: email send becomes a no-op with a logged notice when unconfigured), `feature: granola` (OPENAI_API_KEY when ENABLE_GRANOLA=true). Server boot fails fast with a readable list when core vars are missing. New `npm run doctor` script performs live checks: DB `select 1`, storage HeadBucket + a put/delete round-trip, Deepgram key validation, LLM one-token ping, app-URL reachability note. Doctor output is the first thing the troubleshooting docs reference.

**1.5 De-instance the code.** CSP `frame-src` built from `NEXT_PUBLIC_APP_URL`; `/api/contact` fallback message made generic; migration page default removed in favor of the env var.

## Phase 2 — Accounts: first-run, reset, invites

**2.1 First-run setup.** When `auth.users` is empty, unauthenticated visits to `/login` (and `/`) redirect to `/setup`: a branded create-admin form (email + password) that calls `supabase.auth.admin.createUser` (service role, auto-confirmed), seeds `user_preferences` with `role='admin'`, signs the user in, and lands on the dashboard. Middleware allowlists `/setup` only while the user table is empty (re-checked server-side on submit to prevent a race).

**2.2 Password reset.** `/login` gains "Forgot password" → Supabase `resetPasswordForEmail` → `/auth/reset` page consuming the recovery token. Documented Supabase SMTP note (default Supabase mailer works; custom SMTP optional).

**2.3 Invite-based multi-user.** New `invites` table (id, created_by, email, token hash, expires_at, accepted_at). Admin-only settings surface to create/revoke invites; `POST /api/invites` emails an accept link (Mailgun when configured, otherwise the link is shown in the UI to copy manually — email stays optional). `/setup/accept/[token]` validates token + expiry, creates the user (role `member`), signs in. No open signup; no `ALLOW_OPEN_SIGNUP` flag in v1 (invites cover the need).

**2.4 Multi-user safety sweep.** MCP owner resolution: error loudly when >1 user exists and `MCP_OWNER_ID`/`MCP_OWNER_EMAIL` is unset (single-user keeps the convenient fallback). Audit confirmed queries are owner-scoped; the sweep re-verifies `recent`, search, folders, brand profiles, and adds a unit test asserting cross-user isolation on the main list queries. `INTEGRATION_API_TOKEN`-authed endpoints get the same owner-pinning review.

**2.5 Role column.** `user_preferences.role` (`admin` | `member`, default `member`; first-run setup writes `admin`). Only admins manage invites. No other permission differences in v1.

## Phase 3 — Reliability

**3.1 pg-boss boot-warm, attempt 2.** Root cause of the May outage was bundling: `instrumentation.ts` pulled `pg`/`pgpass` into the webpack server bundle. Fix: add `pg-boss`/`pg` to `serverExternalPackages` in `next.config.ts`, guard the hook with `process.env.NEXT_RUNTIME === 'nodejs'` and a dynamic `import()`, wrap in try/catch so a warm-up failure can never take the app down. **Verification gate (hard requirement before merge):** `next build` green AND the production container boots locally AND `/api/health` shows workers alive without any prior enqueue.

**3.2 Real health endpoint.** `/api/health` returns: db ok/fail, boss started bool, per-queue pending/active/failed counts, oldest-pending age, build commit. Degraded states return 200 with `status: "degraded"` (so orchestrators don't flap) unless DB is down (503). Compose healthcheck + uptime-monitor guidance in docs.

**3.3 Stuck-job watchdog.** A pg-boss scheduled job (every 10 min) that finds media_objects stuck in non-terminal states past per-state thresholds (e.g., `transcribing` > 2h, `processing` > 1h) and marks them `failed` with a `failure_reason`. Job failures (Deepgram payment, LLM auth) write `failure_reason` at the point of failure too.

**3.4 Failure UX + retry.** `failed` status renders on dashboard cards, edit page, and share page with the human-readable reason. A **Retry** button (owner-only) re-enqueues from the appropriate stage (re-transcribe if no transcript; re-run AI jobs if transcript exists). This productizes `requeue-ai-jobs.mjs` / `retrigger-stuck-transcripts.mjs`.

**3.5 Upload retry.** `upload-coordinator.ts`: part PUTs and part-URL fetches retry 3× with exponential backoff + jitter; a failed part re-requests a fresh presigned URL. `beforeunload` warning while an upload is in flight. (IndexedDB resume-after-crash: explicitly deferred.)

**3.6 Shared API error helper.** `apiError(status, code, message)` + `withApiErrorHandling(handler)` wrapper: consistent JSON shape, 500s log the error server-side and return a generic message (no stack/internal leak). Adopt in all routes touched by this effort and the top-traffic routes; replace the two `alert()` calls with toasts.

## Phase 4 — Pluggable transcription

A minimal provider interface in `src/lib/transcription/`: `submitTranscription(recording, audioUrl) → { mode: 'callback' } | { mode: 'sync', result }`. `TRANSCRIBE_PROVIDER` env var finally read:

- `deepgram` (default): existing async webhook path, unchanged.
- `openai-whisper`: synchronous call inside the `transcribe` pg-boss job (downloads audio from storage, posts to OpenAI, normalizes to the existing transcript shape including utterances where available). No public callback URL required — this unlocks LAN-only/airgapped-ish self-hosting where Deepgram's webhook can't reach the instance, and removes the ngrok requirement for local dev transcription.

Provider choice validated by the env contract (Phase 1.4) and doctor. Local whisper.cpp documented as a future provider behind the same interface (out of scope).

## Phase 5 — Distribution

**5.1 Configurable Chrome extension.** Options page (and first-run popup prompt) storing the app origin in `chrome.storage.sync`; `optional_host_permissions: ["https://*/*", "http://localhost/*"]` requested at runtime for the configured origin; `background.js` tab queries and content-script injection driven by the stored origin. Default origin remains Ian's instance so his own install keeps working. Manifest version bumped per the reload protocol.

**5.2 Notarized desktop releases.** GitHub Actions workflow on `v*` tag: macOS runner builds release config, signs with Developer ID Application cert, notarizes via `notarytool`, staples, produces a `.dmg`, attaches to the GitHub Release. Repo secrets needed from Ian (one-time, guided): base64 .p12 + password, notary API key (issuer/key ID/key). Until secrets land, the workflow degrades to an unsigned artifact with a clear name. `desktop/README.md` updated: download-the-dmg is the primary path, build-from-source the fallback.

**5.3 Prebuilt web image.** GHCR publish (`ghcr.io/deducer/loomola`) on tag push, multi-stage build args documented (NEXT_PUBLIC_* are build-time — the workflow builds with placeholder-safe handling and docs explain the constraint; if placeholders prove unworkable for NEXT_PUBLIC vars, compose defaults to `build: .` and the GHCR image is positioned for users who pass build args — decided during implementation with a working compose as the acceptance bar).

**5.4 Release engineering.** Tag `v1.0.0` when this effort completes; package.json version synced; CHANGELOG gains per-version sections going forward; GitHub Release notes generated from CHANGELOG.

## Phase 6 — Hygiene & docs

- Untrack `docs/Granola UI Screenshots/` and `.claude/settings.local.json`; add both to `.gitignore`. (CLAUDE.md/AGENTS.md/specs stay — honest dev artifacts.)
- Add CONTRIBUTING.md (dev setup, test commands, PR expectations), SECURITY.md (private disclosure contact), `.github/ISSUE_TEMPLATE/` (bug + setup-help + feature), PR template.
- ESLint flat config (`eslint-config-next` baseline) + `npm run lint`; CI gains lint + `next build` jobs.
- README rewritten around the new reality: hero screenshots/GIF (captured from the live instance), `docker compose up` as the primary quickstart, Supabase as the one required account, decision table for R2 vs MinIO and Deepgram vs Whisper. Deep operational detail moves to `docs/self-hosting.md` (backup guidance: pg_dump + bucket sync, upgrade procedure, health monitoring, troubleshooting table keyed to doctor output).
- The Abb test: docs must stand alone. Anything Abb asks Ian on the call is by definition a docs bug — capture and fix after the session.

## Testing strategy

- Unit (Vitest, existing suite): env contract resolution, invite token lifecycle (issue/expire/accept/replay), watchdog state transitions, transcription provider dispatch + Whisper response normalization, upload retry/backoff decision logic, API error helper shape, CSP origin derivation, S3 endpoint resolution.
- CI: lint + typecheck + unit + `next build` on every PR/push.
- Manual gates: containerized boot test for 3.1 (hard requirement given history); full compose-from-scratch run on a clean machine before the Abb session; extension round-trip against a non-dissonance origin; one notarized .dmg installed on a second Mac account.
- Final acceptance: the recorded Abb setup call, unassisted.

## Out of scope (explicitly)

Auth decoupling from Supabase; open signup; team/sharing permissions between users; IndexedDB upload resume; local whisper.cpp provider; Chrome Web Store + Safari/Firefox; iOS/Android/Windows; git history rewrite; adaptive bitrate.

## Sequencing

Phases ship independently to `main` in order 1 → 6, except Phase 6's repo hygiene items (untracking, community files, ESLint) which can land immediately alongside Phase 1. Phases 1+6 make the project credible, 2 adoptable, 3 premium, 4+5 competitive. Estimated ~2 weeks of focused agent work.
