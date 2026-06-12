# Changelog

Loomola used date-based release notes while the product was pre-1.0; those
entries are preserved below. From v1.0.0 onward, each release gets a
version section (`## v1.1.0 — 2026-07-01`) accumulated under `## Unreleased`
between tags. GitHub Releases are generated per tag by CI and point here
for the curated notes.

## v1.0.0 — 2026-06-11

### Added

- **One-command self-host.** `docker-compose.yml` bundles MinIO for storage so you can go from `git clone` to a working instance with a single `docker compose up --build`. Supabase (free tier) is the only required external account.
- **Doppler-optional container.** `docker-entrypoint.sh` runs with or without Doppler: `DOPPLER_TOKEN` set → Doppler injects secrets; unset → env vars pass through directly.
- **Generic S3 storage endpoint.** `S3_ENDPOINT` env var lets you point at MinIO, AWS S3, or any S3-compatible store. Existing `R2_*` variable names are unchanged. CSP `media-src` is derived from the resolved endpoint instead of hardcoded to `*.r2.cloudflarestorage.com`.
- **`npm run doctor`.** Live pre-flight checks: database `SELECT 1`, storage HeadBucket + put/delete round-trip, Deepgram key validation, LLM one-token ping. One line per service; first thing the troubleshooting docs point to.
- **Fail-fast env contract.** Container exits with a readable list of missing variables on boot when any core var is absent. LLM, transcription, and email variables are optional and degrade gracefully.
- **Pluggable transcription.** `TRANSCRIBE_PROVIDER=openai-whisper` transcribes synchronously via OpenAI Whisper — no public callback URL, so localhost/LAN self-hosting gets full transcription with zero tunnels. Deepgram remains the default and is unchanged. Whisper transcripts have no speaker labels and cap at ~1 hour (OpenAI 25MB limit); longer recordings fail with a clear reason and a Retry path. `npm run doctor` and boot-time env validation now check the provider choice, including invalid values.
- **Transcript markdown and SRT export.** `GET /api/recordings/[id]/transcript.md` and `.srt` export the full transcript with timestamps.
- **First-run admin setup.** A fresh install with no users routes to `/setup` where the admin creates their account in-browser. No Supabase dashboard required.
- **Password reset.** Self-serve reset link flow via `/login/forgot`. Supabase sends the email; the link exchanges through `/auth/callback` and lands on a password-change form.
- **Invite-based multi-user.** Admins can issue invite links from `/settings/users` (7-day expiry, single-use). Each invited member sees only their own recordings, folders, and notes. If email (Mailgun) is not configured, the invite link is shown in the UI for manual sharing.
- **Users settings page** (`/settings/users`). Lists all accounts on the instance, pending invites, and accepted/expired invite history. Invite revocation is available for pending invites.
- **MCP multi-user guard.** When more than one user exists and `MCP_OWNER_ID` / `MCP_OWNER_EMAIL` are not set, the MCP server now errors with a clear message instead of silently falling back to the first user.
- **Real `/api/health` endpoint.** Reports database status, pg-boss started state, per-queue pending/active/failed counts and oldest-pending age, and the build commit. Returns `"degraded"` (HTTP 200) or `"down"` (HTTP 503). Powers the docker-compose healthcheck and uptime monitors.
- **Stuck-recording watchdog.** pg-boss scheduled job (every 10 min) marks recordings stuck in non-terminal states as `failed` with a human-readable reason: `transcribing` > 2h, `processing` > 1h, `uploading` > 24h.
- **`failure_reason` column.** Written at known pipeline failure points (Deepgram error, LLM auth failure, Whisper size limit, watchdog timeout). Human-readable; does not expose stack traces.
- **Failure UX + Retry.** `failed` recordings show a red badge and the failure reason on dashboard cards, the edit page, and (generically) the share page. The owner Retry button re-enqueues from the correct stage (re-transcribes if no transcript; re-runs AI jobs if transcript exists).
- **Upload retry.** Part PUT requests retry 3× with exponential backoff; each retry requests a fresh presigned URL. A browser unload warning fires if an upload is in flight.
- **Configurable Chrome extension (v0.9.0).** App origin stored in `chrome.storage.sync`; an options page lets self-hosters point the extension at their own instance without editing any source files. Dynamic content-script registration replaces hardcoded manifest matches for the app bridge. Default origin remains `https://loom.dissonance.cloud`.
- **Notarized macOS desktop release workflow.** GitHub Actions workflow on `v*` tags builds, signs, notarizes, and attaches a `.dmg` to the GitHub Release. Falls back to an unsigned `.zip` when notarization secrets are not configured.
- **GHCR Docker image.** `ghcr.io/deducer/loomola` published on every push to `main` and on release tags. Note: `NEXT_PUBLIC_*` vars are baked in at build time; self-hosters should use `docker compose up --build` to embed their own values.
- **Boot-warmed pg-boss, attempt 2.** `src/instrumentation.ts` warms pg-boss at container boot via a dynamic import inside `process.env.NEXT_RUNTIME === 'nodejs'` guard, with `pg-boss`/`pg` in `serverExternalPackages` to prevent webpack bundling. Attempt 1 (May 2026) caused a prod outage; this version is safe.
- **Community files.** CONTRIBUTING.md, SECURITY.md, GitHub issue templates (bug, setup-help, feature), and pull request template.
- **ESLint flat config** (`eslint-config-next` baseline) + `npm run lint`. CI gains lint and `next build` jobs.
- **`docs/self-hosting.md`.** Ops runbook: architecture overview, `/api/health` field reference, uptime monitor wiring, backup procedures, upgrade/rollback procedure, troubleshooting symptom table.
- **`docs/releasing.md`.** Release procedure: CHANGELOG convention, version sync, tag-and-push workflow, GitHub Release generation.
- **v1.0.0.** `package.json` version and `desktop/App/Info.plist` CFBundleShortVersionString synced to `1.0.0`.

### Security

- Auth callback `?next=` parameter is now validated to same-origin paths only, blocking open-redirect tricks (`//evil.com`, `/\evil.com`, absolute URLs).
- CSP `frame-src` and `media-src` derive from `NEXT_PUBLIC_APP_URL` / storage endpoint instead of hardcoded `loom.dissonance.cloud` domain.

### Changed

- `login` page: "Forgot password" link added.
- Dashboard: failed recordings show a reason badge and Retry button; no longer silently stuck.
- Upload coordinator: unload warning while upload is in-flight.

### Fixed

- `alert()` calls replaced with sonner toasts.
- API error responses now have a consistent JSON shape; 500s log server-side and return a generic message (no stack/internal leak).

### Notes

- This is the v1.0.0 milestone: the first release intended for general self-hosting by people other than the maintainer.
- The Abb acceptance test (unassisted stranger setup on a recorded call) is the real gate; tagging happens when that passes.

## 2026-05-21

### Added

- Loomola recording share links now include Slack/Discord-friendly Open Graph and Twitter card metadata with per-recording title, summary, and thumbnail.
- Added a stable public thumbnail route for link unfurls. Public, ready recordings serve the generated video thumbnail; locked, missing, not-ready, or thumbnail-less links show a generic Loomola image instead.

### Notes

- Slack and Discord cache previews by exact URL. Add a query string when retesting a link that was pasted before this release.

## 2026-05-13

### Added

- Real-time Deepgram transcription for desktop audio notes, with the transcript ready when recording stops.
- Manual `Generate notes` / `Regenerate notes` flow for audio notes so AI credits are spent only when the user asks.
- Granola-style live transcript drawer in the desktop note workspace, including copy, collapse, search affordance, speaker-side layout, word count, and transcript-updated note regeneration state.
- Desktop note workspace polish: top chrome alignment, refined transcript cards, cleaner typography, fixed ellipsis hover/click target, wider generated-note editor, and smoother recording controls.
- Changelog for product-style release tracking.

### Changed

- The desktop app now syncs server-backed preferences on sign-in, not only when Settings is opened.
- Settings now only exposes controls that are currently wired to behavior. Deferred transcript-retention, product-update, calendar connector, desktop-only connector, and team-settings placeholders are hidden for now.
- Share-page mobile player overlay now centers the large play button over the visible video area without changing desktop behavior.
- The local desktop installer ignores local Codex settings when deciding whether the installed app build should be stamped as dirty.

### Fixed

- Video recording stop now auto-hides the floating camera bubble.
- Quitting during a recording now offers a clear discard-and-quit path.
- Live transcription startup now uses server-minted Deepgram live tokens and handles refreshed credentials cleanly.
