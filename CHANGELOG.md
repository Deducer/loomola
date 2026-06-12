# Changelog

Loomola used date-based release notes while the product was pre-1.0; those
entries are preserved below. From v1.0.0 onward, each release gets a
version section (`## v1.1.0 — 2026-07-01`) accumulated under `## Unreleased`
between tags. GitHub Releases are generated per tag by CI and point here
for the curated notes.

## Unreleased

- Distribution: configurable Chrome-extension origin (options page),
  notarized desktop release pipeline, GHCR image publishing, and release
  engineering. (Phase 5 of the open-source readiness effort.)

## 2026-06-10

### Added

- **Pluggable transcription.** `TRANSCRIBE_PROVIDER=openai-whisper` transcribes synchronously via OpenAI Whisper — no public callback URL, so localhost/LAN self-hosting gets full transcription with zero tunnels. Deepgram remains the default and is unchanged. Whisper transcripts have no speaker labels and cap at ~1 hour (OpenAI 25MB limit); longer recordings fail with a clear reason and a Retry path. `npm run doctor` and boot-time env validation now check the provider choice, including invalid values.
- **First-run admin setup.** A fresh install with no users routes to `/setup` where the admin creates their account in-browser. No Supabase dashboard required.
- **Password reset.** Self-serve reset link flow via `/login/forgot`. Supabase sends the email; the link exchanges through `/auth/callback` and lands on a password-change form. Works without any infra changes.
- **Invite-based multi-user.** Admins can issue invite links from `/settings/users` (7-day expiry, single-use). Each invited member sees only their own recordings, folders, and notes. If email (Mailgun) is not configured, the invite link is shown in the UI for manual sharing.
- **Users settings page** (`/settings/users`). Lists all accounts on the instance, pending invites, and accepted/expired invite history. Invite revocation is available for pending invites.
- **MCP multi-user guard.** When more than one user exists and `MCP_OWNER_ID` / `MCP_OWNER_EMAIL` are not set, the MCP server now errors with a clear message instead of silently falling back to the first user.

### Security

- Auth callback `?next=` parameter is now validated to same-origin paths only, blocking open-redirect tricks (`//evil.com`, `/\evil.com`, absolute URLs).

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
