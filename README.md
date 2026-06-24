# Loomola

> **Capture you own.**

Self-hosted screen recording + AI meeting notes. Open-source alternative to Loom + Granola, in one product.

> Active dev. Invite-based multi-user. The live instance at [loom.dissonance.cloud](https://loom.dissonance.cloud) is what I use daily as my own Loom + Granola replacement.

## What it is

Two products in one self-hosted codebase, gated by a single env flag (`ENABLE_GRANOLA`):

- **Screen recording (Loom-shape).** Screen + camera + mic + system audio, captured in the browser via the [companion Chrome extension](extension/). Branded share pages with Slack/Discord link previews, comments, view tracking, AI-generated titles, summaries, chapters, action items, and hover-scrub thumbnails.
- **AI meeting notes (Granola-shape).** Real-time audio transcription from a native macOS desktop app. Live notepad while the meeting runs. Manual AI notes generation when the user is ready. Attendee tracking, folder organization, speaker attribution.

Both surfaces use the same Postgres / R2 / Deepgram / Claude pipeline. Same `media_objects` table with a `type` column, so adding a third product (something like MacWhisper, say) reuses everything.

## Why this vs. the alternatives

| | Loom | Granola | [Cap](https://github.com/CapSoftware/Cap) | **Loomola** |
|---|---|---|---|---|
| Screen recording | ✓ | — | ✓ | ✓ |
| AI meeting notes | — | ✓ | — | ✓ |
| Self-host | — | — | ✓ | ✓ |
| Pricing (you) | $12.50–$20 / user / month | $20 / user / month (Pro) | Free + paid managed | Free; you pay your own infra (~$15–25/mo total across Supabase + R2 + Deepgram + Anthropic on light usage) |
| Transcription | proprietary | proprietary (real-time, no audio kept) | local Whisper | **Deepgram** (best-in-class hosted, ~$0.0043/min) |
| AI summaries | basic | yes | basic | Claude Sonnet 4.6 with structured Zod output |
| Custom branding on share pages | enterprise tier | — | — | ✓ (logo + accent + Google Font + CTA + footer per brand profile) |
| Status | Atlassian-owned; [raised prices ~100× in Feb 2026](https://x.com/heynavtoor/status/2052307308253003921) | Active, free tier locks notes >30d | 18k★ active OSS | Active OSS, invite-based multi-user |

## How this came to exist

I got excited the day I found Cap. Shared it around, dug in, spent a few hours trying to get the transcription path working on real meeting audio. It wasn't behaving the way I expected. I submitted my findings to the repo, a couple of other people chimed in saying they were seeing the same thing, and no fix arrived. Solo OSS with finite time, totally fair. Real respect for what Richie has built, no shade at all.

But I needed something that worked, and I also wanted Granola-shape meeting notes living alongside the screen recordings. That combination didn't exist anywhere I could find on the OSS side, so I started building Loomola. It's been my daily driver for a couple of months now.

If you pay for both Loom AND Granola today, this is the package that replaces both at once.

## Tech stack

**Web.** Next.js 15 (App Router), React 19, TypeScript, Tailwind 4. Supabase for Postgres, Auth, and Realtime. Drizzle ORM. `pg-boss` for the job queue, so no Redis. Cloudflare R2 for object storage with zero egress on the free tier. Deepgram async transcription with signed callbacks. Anthropic Claude via the Vercel AI SDK with Zod-validated structured output. Plyr 3.x for the player. Mailgun for the comment and first-view notification emails.

**Desktop (macOS).** Native SwiftUI app for the audio meeting notes plus a premium composite video recorder. AVAudioEngine, ScreenCaptureKit, AVAssetWriter, CIContext. Bundles Inter and JetBrains Mono. About 10k lines of Swift across capture, UI, and orphan recovery.

**Chrome extension** (`extension/`). Manifest V3. Injects a frameless `/bubble` iframe into every tab the user is on, so the camera bubble survives tab switches during a screen recording. Single source of truth for the bubble pixels.

**Deploy.** Single `node:22-alpine` container with `ffmpeg` baked in for thumbnails and preview sprites. Doppler manages env at boot. Migrations run automatically. I use [Coolify](https://coolify.io) on a $7/mo Hostinger VPS, but any Docker host works.

## Self-host Quickstart

This is the path for a friend cloning the repo and running their own Loomola.
Do not copy Ian's `.env.local`; create fresh accounts and keys.

### Easiest path: let an AI assistant walk you through it

Not a developer? You don't have to follow the steps below by hand. Open this
repository in an AI coding assistant (Claude Code, Cursor, Codex, etc.) and say:

> Help me set up my own private copy of Loomola from scratch. Follow the
> README's "Self-host Quickstart" using the Docker Compose path with a free
> Supabase project. Walk me through it one step at a time. This is my own fresh
> instance — don't push anything to the repo, and don't use anyone else's
> infrastructure (no Doppler, no Coolify, no existing domain).

The assistant will read this README and walk you through creating accounts,
filling in config, launching, and testing. Everything below is the same path
written out for humans — read on if you'd rather do it yourself.

Two choices up front:

- **Loom-only or Loom + Granola.** Start with `ENABLE_GRANOLA=false` if you only want screen recordings. Set it to `true` when you also want the macOS audio-meeting-notes product.
- **Local or deployed.** `http://localhost:3000` is enough to open the app and test auth/UI — and, with `TRANSCRIBE_PROVIDER=openai-whisper`, for the full record-to-transcript pipeline. Deepgram transcription callbacks, public share links, and social unfurls still need a public HTTPS app URL. Use a deploy, ngrok, or Cloudflare Tunnel if you want those.

**Database & auth — two options:**

- **Free Supabase cloud (default, recommended).** A free Supabase project gives you Postgres + auth in a couple of clicks, and it's what the quickstart below uses. Loomola's media (video/audio) is served from your own object storage, never through Supabase, so the only data crossing Supabase is small database query results — a single user stays comfortably inside the free tier. (Free-tier notes: ~5 GB/mo egress, and free projects pause after ~7 days with no activity — daily use keeps it awake. Limits change; check Supabase's current free tier.)
- **Self-hosted Supabase = $0 forever (advanced).** Want nothing external and no usage caps at all? Run Supabase on your own VPS with Coolify — same software, no app changes, just your VPS. See [`docs/self-hosting-supabase.md`](docs/self-hosting-supabase.md). Best for people already comfortable with Coolify/VPS admin.

### Quickstart A — Docker Compose (recommended)

Needs **[Docker Desktop](https://www.docker.com/products/docker-desktop/)** (or Docker Engine + Compose) installed and running. Bundled MinIO for storage; you bring a free [Supabase](https://supabase.com) project (Postgres + auth) and an [Anthropic](https://console.anthropic.com) key for AI summaries. For transcription you choose **OpenAI Whisper** (works on localhost immediately) or **Deepgram** (needs a public URL) — see the note after the commands.

**Getting your Supabase values:** create a free project at [supabase.com](https://supabase.com), then from the dashboard copy the **Project URL**, **anon key**, and **service-role key** (Settings → API) and the **database connection string** (Settings → Database). Those four fill the Supabase + `DATABASE_URL` lines in `.env.compose`. You don't need to create a user — Loomola's first-run screen does that. (Prefer no external account at all? See the self-hosted-Supabase option above.)

```bash
git clone https://github.com/Deducer/loomola.git
cd loomola
cp .env.compose.example .env.compose
# Fill in: Supabase URL/keys/DATABASE_URL, Anthropic, a transcription
# provider (see below), and a random MINIO_ROOT_PASSWORD (openssl rand -hex 32).
docker compose --env-file .env.compose up -d --build
```

**Transcription on localhost — important:** the default `TRANSCRIBE_PROVIDER=deepgram` needs a public HTTPS URL (Deepgram calls back to your app), so on `http://localhost:3000` recordings will hang in "transcribing." For a local first run, set `TRANSCRIBE_PROVIDER=openai-whisper` in `.env.compose` and put your key in `OPENAI_API_KEY` — Whisper runs in-process with no callback. Switch to Deepgram once you're on a public URL and want speaker labels / unlimited length.

Open http://localhost:3000. The first visit walks you through creating your admin account. Migrations run automatically at boot, and the container fails fast with a readable list if a required variable is missing. To verify every external service is wired correctly:

```bash
npm install && npm run doctor   # live checks against your config
```

`npm run doctor` needs Node 22 installed locally (the Docker path otherwise doesn't). It's optional — the container already validates required env at boot and fails fast with a readable list, and `docker compose logs app` shows the same. Use `doctor` when you want a one-line-per-service health check.

The manual path below (Quickstart B) gives you `npm run dev` for development.

### Prebuilt image (GHCR)

`ghcr.io/deducer/loomola` is published on every push to `main` and on
release tags. Caveat that matters: Next.js inlines `NEXT_PUBLIC_*`
(your Supabase URL and anon key) into the JavaScript bundle **at build
time**, and the public image is built with placeholders — so sign-in in
the browser cannot work with it as-is. There is no runtime override.

- **Self-hosting?** Use `docker compose up` — it builds the image with
  your values from `.env.compose`. This is the supported path.
- **Want your own prebuilt image?** Fork the repo and run the
  "Publish Docker image" workflow with your `NEXT_PUBLIC_*` values as
  inputs; it publishes to your fork's GHCR namespace.
- The public image is still useful as a build-cache source and for
  poking at the container layout.

### Quickstart B — Manual (npm run dev)

#### 1. Install Local Prerequisites

On macOS:

```bash
xcode-select --install
brew install node@22 ffmpeg git
```

Use Chrome or another Chromium browser for screen recording. Safari/Firefox are not supported for the full recorder because the browser capture APIs are Chrome-only.

#### 2. Create Service Accounts

All of these have free tiers that are enough for one person:

1. **Supabase** for Postgres, Auth, and Realtime: [supabase.com](https://supabase.com)
2. **Cloudflare R2** for object storage: [cloudflare.com/r2](https://www.cloudflare.com/products/r2/)
3. **Deepgram** for transcription: [deepgram.com](https://deepgram.com)
4. **Anthropic** for title/summary/chapter generation: [console.anthropic.com](https://console.anthropic.com)
5. **OpenAI** for embeddings/search when Granola is enabled: [platform.openai.com](https://platform.openai.com)
6. **Mailgun** for notification/contact emails: [mailgun.com](https://mailgun.com)

Supabase setup:

- Create a project.
- Copy the Project URL, anon key, service-role key, and database connection string.
- In Supabase Auth, make sure Email/password auth is enabled.
- No manual user creation needed: the first time you open the app it walks you
  through creating your admin account in-browser.
- In URL Configuration, set Site URL to your app origin. Add redirect URLs for `http://localhost:3000/auth/callback` and, if deployed, `https://your-domain.com/auth/callback`.

Cloudflare R2 setup:

- Create a bucket, for example `loomola`.
- Create R2 S3 API credentials with read/write access to that bucket.
- Add a CORS policy to the bucket. Include both local and production origins if you use both:

```json
[
  {
    "AllowedOrigins": ["http://localhost:3000", "https://your-domain.com"],
    "AllowedMethods": ["GET", "PUT", "POST", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

`ExposeHeaders: ["ETag"]` matters. Browser multipart uploads read each R2 part's `ETag`; without it, uploads fail even though the PUT request may look successful.

#### 3. Clone and Configure

```bash
git clone https://github.com/Deducer/loomola.git
cd loomola
npm install
cp .env.example .env.local
```

Fill in `.env.local`. Generate the random secrets with:

```bash
openssl rand -hex 32
```

Use that for `VIEW_UNLOCK_SECRET`, `VISITOR_HASH_SALT`, `DEEPGRAM_CALLBACK_SIGNING_SECRET`, `INTEGRATION_API_TOKEN`, and `MCP_TOKEN` if you enable MCP.

For local UI-only testing, `NEXT_PUBLIC_APP_URL=http://localhost:3000` is fine. For real transcription, set it to a public HTTPS URL:

```bash
# Example with ngrok
ngrok http 3000
# Then set NEXT_PUBLIC_APP_URL=https://the-ngrok-url.ngrok-free.app
```

Restart `npm run dev` after changing `NEXT_PUBLIC_APP_URL`; Deepgram receives the callback URL when the transcribe job is created. Alternatively, set `TRANSCRIBE_PROVIDER=openai-whisper` to transcribe synchronously without any public callback URL — localhost works as-is.

### Transcription: Deepgram vs OpenAI Whisper

| | `deepgram` (default) | `openai-whisper` |
|---|---|---|
| How it runs | Async — Deepgram calls your instance back | Synchronous inside the job — no callback |
| Works on `http://localhost` / LAN, no tunnel | No — needs a public HTTPS app URL | **Yes** |
| Speaker labels (diarization) | Yes | No — whole transcript is one speaker |
| Recording length | No practical limit | ~1 hour (OpenAI 25MB audio cap); longer recordings fail with a clear reason and can be retried after switching providers |
| Live in-meeting transcript drawer (`ENABLE_GRANOLA`) | Yes | Still requires a Deepgram key |
| Keys needed | `DEEPGRAM_API_KEY` + `DEEPGRAM_CALLBACK_SIGNING_SECRET` | `OPENAI_API_KEY` |

Set `TRANSCRIBE_PROVIDER=openai-whisper` if you are self-hosting on a LAN or
just don't want to run a tunnel for local dev transcription. Everything
downstream (titles, summaries, chapters, action items, search) is identical.
A local whisper.cpp provider behind the same interface is a planned follow-up.

#### 4. Migrate and Run

```bash
npm run db:migrate
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), sign in with the Supabase user you created, and record a short test.

Expected flow:

1. `/record` creates an upload row.
2. Browser uploads media parts directly to R2.
3. Server completes the multipart upload.
4. Deepgram transcribes the recording and calls back to your app.
5. pg-boss workers generate the title, summary, chapters, action items, thumbnails, preview sprite, and downloads.

If the recording stays in `transcribing`, the most common cause is `NEXT_PUBLIC_APP_URL` pointing at localhost or another URL Deepgram cannot reach.

### 5. Install the macOS Desktop App

The desktop app is optional for Loom-style browser recording, but it is the best way to use the Granola-style audio meeting notes and the native recorder.

Make sure `.env.local` contains:

```text
LOOM_API_BASE_URL=http://localhost:3000
LOOM_SUPABASE_URL=<your Supabase project URL>
LOOM_SUPABASE_ANON_KEY=<your Supabase anon key>
```

For a deployed instance, use `LOOM_API_BASE_URL=https://your-domain.com`.

Then:

```bash
cd desktop
./scripts/install-local-app.sh
```

That builds, locally signs, installs, and launches `/Applications/Loomola.app`.
Grant Camera, Microphone, Screen Recording, and Accessibility permissions when macOS asks. If you change Screen Recording permission, quit and relaunch the app.

Desktop details live in [`desktop/README.md`](desktop/README.md).

### 6. Chrome Extension for the Polished Bubble

The web recorder works without the extension, but the extension gives you the frameless Loom-style camera bubble.

Load the `extension/` folder as an unpacked Chrome extension at `chrome://extensions` (Developer mode on → Load unpacked → select `extension/`). No source editing needed — point it at your instance from the built-in options page (right-click the extension icon → Options) and enter your app origin. More detail is in [`extension/README.md`](extension/README.md).

### Inviting more users

Loomola supports multiple accounts on one instance. As the admin, open
`/settings/users` on your instance to send invite links (7-day expiry,
single use). Each user sees only their own recordings, folders, and notes.
If email isn't configured, copy the invite link from the UI and send it
yourself. Password resets are self-serve from the sign-in page.

### Production Deploy Notes

The container supports Doppler as an optional secrets manager: when the host sets a single `DOPPLER_TOKEN` env var, Doppler injects everything else before migrations and `server.js` run. Without it, env vars pass through directly.

Recommended production path with Doppler:

1. Create a Doppler project/config for Loomola.
2. Copy the same values from `.env.local` into Doppler.
3. In your host/Coolify app, set only `DOPPLER_TOKEN` as the runtime secret.
4. Set Docker build args for `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `NEXT_PUBLIC_APP_URL` because Next.js inlines public env vars at build time.
5. Point DNS at the host, enable HTTPS, and set `NEXT_PUBLIC_APP_URL=https://your-domain.com`.
6. Add the production origin to R2 CORS and Supabase Auth URL settings.

The container no longer requires Doppler: with `DOPPLER_TOKEN` set it injects
secrets at boot (the maintainer's setup); without it, env vars pass through
directly (`docker compose` / `docker run --env-file`).

For ongoing ops — health monitoring, backups, upgrades, and a full
troubleshooting table — see [`docs/self-hosting.md`](docs/self-hosting.md).

### Common Setup Failures

| Symptom | Likely cause | Fix |
|---|---|---|
| Anything at all | Misconfigured service | Run `npm run doctor` — it live-checks DB, storage, Supabase, Deepgram, and LLM keys with one line per service |
| `DATABASE_URL is not set` | `.env.local` missing or command run from the wrong folder | Run commands from repo root and fill `.env.local` |
| Upload fails with missing `ETag` | R2 CORS does not expose `ETag` | Add `ExposeHeaders: ["ETag"]` to bucket CORS |
| Recording stuck in `transcribing` | Deepgram cannot reach `NEXT_PUBLIC_APP_URL` | Use deployed HTTPS, ngrok, or Cloudflare Tunnel — **or set `TRANSCRIBE_PROVIDER=openai-whisper` (no callback needed)** |
| Whisper recording fails with "over OpenAI's 25MB limit" | Recording longer than ~1 hour | Switch to `TRANSCRIBE_PROVIDER=deepgram` and press Retry on the recording |
| Login fails | Supabase user does not exist or is not confirmed | Open your instance — first visit routes to `/setup` to create the admin account |
| Desktop app talks to Ian's prod | `LOOM_API_BASE_URL` left at default | Set `LOOM_API_BASE_URL` or `LOOM_DESKTOP_API_BASE_URL` before installing |
| Extension pill says not detected | Extension not pointed at your instance | Right-click extension icon → Options → enter your app origin and save |

## Releases

GitHub Releases are created automatically on every `v*` tag push. Each release includes:

- **macOS `.dmg`** — signed and notarized when the repo secrets are configured; unsigned `.zip` otherwise. Download it from the Release page, or build locally via `desktop/scripts/install-local-app.sh`.
- **GHCR Docker image** — `ghcr.io/deducer/loomola:<version>`. See the GHCR caveat in the Prebuilt image section above for the `NEXT_PUBLIC_*` constraint.

For the tag and CHANGELOG convention, see [`docs/releasing.md`](docs/releasing.md).

## What's shipped (rough roadmap)

- **Stage 1 (M1–M11)**: full Loom-shape product. Recording flow, R2 multipart uploads, Deepgram pipeline, AI title/summary/chapters/action-items, share pages with social previews, comments, view tracking, trim and downloads, polish.
- **Stage 2 (G-M1–G-M17)**: full Granola-shape product. Audio capture, real-time transcripts, AI summaries, attendees, folder organization, multi-folder Phase 1, speaker recognition v1.
- **Stage 3**: security hardening. CSP, HSTS, signed Deepgram callbacks with single-use nonces, rate limits, time-bounded unlock cookies.
- **Stages 4–7**: macOS desktop app. Premium composite recorder, Granola-grade visual shell, live notes side panel, pause/resume, orphan recovery.
- **Stage 8**: Granola-grade desktop note workspace.
- **Stage 9**: reliability. Orphan recovery, Coolify brownout detection, boot-warmed pg-boss.
- **Stage 10 (open-source readiness)**: one-command self-host (`docker compose`), bundled MinIO, `npm run doctor`, first-run admin setup, password reset, invite-based multi-user, failure UX with Retry, real `/api/health`, pluggable transcription (Deepgram + Whisper), configurable Chrome extension with options page, notarized desktop release workflow, GHCR image publishing, v1.0.0.
- **Migration tools**: Granola to Loomola CLI (`migrate/`) using the official Granola Business API. Imports notes, transcripts, summaries, attendees, folders, speaker attribution. Loom import is the next major build.

See [`ROADMAP.md`](ROADMAP.md) for the full status table.

For user-facing release notes, see [`CHANGELOG.md`](CHANGELOG.md).

## What's NOT here yet

- **Team workspaces / sharing between users.** Invite-based multi-user exists (each user manages their own recordings, folders, and notes in isolation). Shared folders, cross-user permissions, and team-level workspaces are not built yet.
- **iOS / Android / Windows desktop.** macOS only for native capture. The web `/record` flow works on any Chrome.
- **Loom's advanced editing surface.** Basic trim (start / end) is shipped. Filler-word removal, edit-by-transcript, AI silence-removal, speed ramps, cursor-zoom, drawing — none built yet.
- **Voice-biometric speaker recognition.** ("Here's Bhaskar's voice across all my recordings.") Spec'd, deferred. See [`docs/superpowers/specs/2026-05-04-speaker-recognition-design.md`](docs/superpowers/specs/2026-05-04-speaker-recognition-design.md).
- **Loom migration tool.** The Granola migrator (`migrate/`) is shipped; Loom import is a separate piece of work.
- **Custom share-page domains** per brand profile (something like `videos.acme.com` mapping to a Loomola brand). Pairs with Brand Layer 2.

## A few honest notes

- **Invite-based multi-user.** The live instance at loom.dissonance.cloud is invite-only. Self-hosting gives you full control: the first-run flow creates your admin account, and you invite others from `/settings/users`.
- **Actively maintained.** I use Loomola every day, so improvements ship often. I'm not making any uptime guarantees, but the project isn't going dormant. If something breaks for you, file an issue.
- **Not affiliated** with Loom, Atlassian, Granola, or Cap. Just a builder who doesn't want to pay $40 per seat per month.
- **License is AGPL-3.0**, same as Cap. You can self-host freely. Anyone running a modified version as a hosted service has to publish their changes. The paid walkthrough video is a separate product, not part of the AGPL-licensed code.

## Author

[Ian Cross](https://github.com/Deducer), solo builder. Find me on X: [@theiancross](https://x.com/theiancross). Live instance at [loom.dissonance.cloud](https://loom.dissonance.cloud).

Issues and PRs welcome. I'm using Loomola every day and contributing to it almost as often, so things keep moving. Happy to entertain help, suggestions, or "this is broken in my setup" reports.
