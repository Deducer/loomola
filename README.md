# Loomola

> **Capture you own.**

Self-hosted screen recording + AI meeting notes. Open-source alternative to Loom + Granola, in one product.

> Active dev. Single-user today. The live instance at [loom.dissonance.cloud](https://loom.dissonance.cloud) is what I use daily as my own Loom + Granola replacement.

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
| Status | Atlassian-owned; [raised prices ~100× in Feb 2026](https://x.com/heynavtoor/status/2052307308253003921) | Active, free tier locks notes >30d | 18k★ active OSS | Active OSS, single-user today |

## How this came to exist

I got excited the day I found Cap. Shared it around, dug in, spent a few hours trying to get the transcription path working on real meeting audio. It wasn't behaving the way I expected. I submitted my findings to the repo, a couple of other people chimed in saying they were seeing the same thing, and no fix arrived. Solo OSS with finite time, totally fair. Real respect for what Richie has built, no shade at all.

But I needed something that worked, and I also wanted Granola-shape meeting notes living alongside the screen recordings. That combination didn't exist anywhere I could find on the OSS side, so I started building Loomola. It's been my daily driver for a couple of months now.

If you pay for both Loom AND Granola today, this is the package that replaces both at once.

## Tech stack

**Web.** Next.js 15 (App Router), React 19, TypeScript, Tailwind 4. Supabase for Postgres, Auth, and Realtime. Drizzle ORM. `pg-boss` for the job queue, so no Redis. Cloudflare R2 for object storage with zero egress on the free tier. Deepgram async transcription with signed callbacks. Anthropic Claude via the Vercel AI SDK with Zod-validated structured output. Plyr 3.x for the player. Mailgun for the comment and first-view notification emails.

**Desktop (macOS).** Native SwiftUI app for the audio meeting notes plus a premium composite video recorder. AVAudioEngine, ScreenCaptureKit, AVAssetWriter, CIContext. Bundles Inter and JetBrains Mono. About 10k lines of Swift across capture, UI, and orphan recovery.

**Chrome extension** (`extension/`). Manifest V3. Injects a frameless `/bubble` iframe into every tab the user is on, so the camera bubble survives tab switches during a screen recording. Single source of truth for the bubble pixels.

**Deploy.** Single `node:22-alpine` container with `ffmpeg` baked in for thumbnails and preview sprites. Doppler manages env at boot. Migrations run automatically. I use [Coolify](https://coolify.io) on a $7/mo Hostinger VPS, but any Docker host works.

## Self-host

Five accounts (all have free tiers sufficient for one user):

1. **Supabase** for Postgres + Auth + Realtime: [supabase.com](https://supabase.com)
2. **Cloudflare R2** for object storage (zero egress on the free tier): [cloudflare.com/r2](https://www.cloudflare.com/products/r2/)
3. **Deepgram** for transcription: [deepgram.com](https://deepgram.com), $200 in free credit
4. **Anthropic** for Claude: [console.anthropic.com](https://console.anthropic.com)
5. **Mailgun** for comment and first-view notification emails (optional): [mailgun.com](https://mailgun.com)

```bash
# 1. Clone
git clone https://github.com/Deducer/loomola
cd loomola

# 2. Configure secrets (every var listed in .env.example needs a real value)
cp .env.example .env.local
# fill it in

# 3. Install + run migrations
pnpm install
pnpm db:migrate

# 4. Local dev on http://localhost:3000
pnpm dev
```

For the macOS desktop app:

```bash
cd desktop
./scripts/install-local-app.sh
# produces /Applications/Loomola.app, ad-hoc signed
```

A pre-recorded setup walkthrough covering Cloudflare R2, Deepgram, Doppler, Coolify deploy, DNS and TLS, and the DB seed is on the way as a paid add-on for people who'd rather watch than read. Live, hands-on setup help is also available paid; DM [@theiancross](https://x.com/theiancross) on X. The repo itself is fully self-hostable from the docs at no cost.

## What's shipped (rough roadmap)

- **Stage 1 (M1–M11)**: full Loom-shape product. Recording flow, R2 multipart uploads, Deepgram pipeline, AI title/summary/chapters/action-items, share pages with social previews, comments, view tracking, trim and downloads, polish.
- **Stage 2 (G-M1–G-M17)**: full Granola-shape product. Audio capture, real-time transcripts, AI summaries, attendees, folder organization, multi-folder Phase 1, speaker recognition v1.
- **Stage 3**: security hardening. CSP, HSTS, signed Deepgram callbacks with single-use nonces, rate limits, time-bounded unlock cookies.
- **Stages 4–7**: macOS desktop app. Premium composite recorder, Granola-grade visual shell, live notes side panel, pause/resume, orphan recovery.
- **Stage 8**: Granola-grade desktop note workspace.
- **Stage 9**: reliability. Orphan recovery, Coolify brownout detection, boot-warmed pg-boss.
- **Migration tools**: Granola to Loomola CLI (`migrate/`) using the official Granola Business API. Imports notes, transcripts, summaries, attendees, folders, speaker attribution. Loom import is the next major build.

See [`ROADMAP.md`](ROADMAP.md) for the full status table.

For user-facing release notes, see [`CHANGELOG.md`](CHANGELOG.md).

## What's NOT here yet

- **Multi-tenant / team accounts.** Single-user today. Sign-up is invite-only on my live instance because I haven't built proper signup yet. The architecture supports it, the UX doesn't.
- **iOS / Android / Windows desktop.** macOS only for native capture. The web `/record` flow works on any Chrome.
- **Loom's advanced editing surface.** Basic trim (start / end) is shipped. Filler-word removal, edit-by-transcript (cut sentences directly out of the transcript), AI silence-removal, speed ramps, cursor-zoom effects, drawing or annotation on the recording — none of these are built yet. None are technically hard; they just haven't been my pain point. If any of them are yours, send a note via the contact form and I'll prioritize whichever the most people ask for.
- **Voice-biometric speaker recognition.** ("Here's Bhaskar's voice across all my recordings.") Spec'd, deferred. See [`docs/superpowers/specs/2026-05-04-speaker-recognition-design.md`](docs/superpowers/specs/2026-05-04-speaker-recognition-design.md).
- **Loom migration tool.** Separate piece of work once the Granola migrator settles.
- **Custom share-page domains** per brand profile (something like `videos.acme.com` mapping to a Loomola brand). Pairs with Brand Layer 2.

## A few honest notes

- **Single-user today.** If you sign up via the live instance you'll bounce off the auth wall. Self-hosting is the path. I'm gauging interest before deciding whether to flip multi-tenant.
- **Actively maintained.** I use Loomola every day, so improvements ship often. I'm not making any uptime guarantees, but the project isn't going dormant. If something breaks for you, file an issue.
- **Not affiliated** with Loom, Atlassian, Granola, or Cap. Just a builder who doesn't want to pay $40 per seat per month.
- **License is AGPL-3.0**, same as Cap. You can self-host freely. Anyone running a modified version as a hosted service has to publish their changes. The paid walkthrough video is a separate product, not part of the AGPL-licensed code.

## Author

[Ian Cross](https://github.com/Deducer), solo builder. Find me on X: [@theiancross](https://x.com/theiancross). Live instance at [loom.dissonance.cloud](https://loom.dissonance.cloud).

Issues and PRs welcome. I'm using Loomola every day and contributing to it almost as often, so things keep moving. Happy to entertain help, suggestions, or "this is broken in my setup" reports.
