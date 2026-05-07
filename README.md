# Loomola

> **Capture you own.**

Self-hosted screen recording + AI meeting notes. Open-source alternative to Loom + Granola, in one product.

> Active dev. Single-user today. The live instance at [loom.dissonance.cloud](https://loom.dissonance.cloud) is what I use daily as my own Loom + Granola replacement.

## What it is

Two products in one self-hosted codebase, gated by a single env flag (`ENABLE_GRANOLA`):

- **Screen recording (Loom-shape)** — screen + camera + mic + system audio, captured in the browser via the [companion Chrome extension](extension/). Branded share pages with comments, view tracking, AI-generated titles, summaries, chapters, action items, and hover-scrub thumbnails.
- **AI meeting notes (Granola-shape)** — real-time audio transcription from a native macOS desktop app. Live notepad while the meeting runs. AI-enhanced summary on stop. Attendee tracking, folder organization, speaker attribution.

Both surfaces use the same Postgres / R2 / Deepgram / Claude pipeline. The schema is polymorphic — `media_objects.type = 'video' | 'audio'` — so adding a third product (e.g., a MacWhisper-shape transcription tool) reuses everything.

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

I was excited the day I found Cap. Posted about it, dug in, spent a few hours trying to get the transcription path working on real meeting audio. It wasn't behaving as intended — I submitted my findings to the repo and a couple of others confirmed seeing the same thing. No fix arrived. I get it: solo OSS, finite time. Genuine respect for what Richie has built and zero shade.

But I needed a working tool, and I also wanted Granola-shape meeting notes alongside the screen recording — and that combination didn't exist anywhere in the OSS landscape I could find. So I started building Loomola. It's been my daily driver for a couple of months now.

If you're paying for both Loom AND Granola today, this is the package that replaces both at once.

## Tech stack

**Web** — Next.js 15 (App Router), React 19, TypeScript, Tailwind 4. Supabase (Postgres + Auth + Realtime), Drizzle ORM. `pg-boss` for job queue (no Redis dependency). Cloudflare R2 for object storage (zero egress). Deepgram async + signed-callback transcription. Anthropic Claude via Vercel AI SDK with Zod-validated structured output. Plyr 3.x for the player. Mailgun for owner-notification emails.

**Desktop (macOS)** — Native SwiftUI app for audio meeting notes + a premium composite-video recorder. AVAudioEngine + ScreenCaptureKit + AVAssetWriter + CIContext. Bundles Inter + JetBrains Mono. ~10k lines of Swift across capture, UI, and orphan-recovery layers.

**Chrome extension** (`extension/`) — Manifest V3. Injects a frameless `/bubble` iframe into every tab so the camera bubble survives tab switches during a screen recording — single source of truth for the bubble pixels, no double-render risk in the composite output.

**Deploy** — Single `node:22-alpine` container with `ffmpeg` for thumbnails + preview sprites. Doppler manages env at boot. Migrations run automatically. I use [Coolify](https://coolify.io) on a $7/mo Hostinger VPS, but any Docker host works.

## Self-host

Five accounts (all have free tiers sufficient for one user):

1. **Supabase** — Postgres + Auth + Realtime. [supabase.com](https://supabase.com)
2. **Cloudflare R2** — object storage, zero egress on the free tier. [cloudflare.com/r2](https://www.cloudflare.com/products/r2/)
3. **Deepgram** — transcription. [deepgram.com](https://deepgram.com) ($200 free credit)
4. **Anthropic** — Claude API. [console.anthropic.com](https://console.anthropic.com)
5. **Mailgun** — comment + first-view notifications, optional. [mailgun.com](https://mailgun.com)

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

A pre-recorded setup walkthrough covering Cloudflare R2, Deepgram, Doppler, Coolify deploy, DNS / TLS, and the DB seed will follow as a paid add-on for people who'd rather watch than read. Live, hands-on setup help is also available paid — DM [@theiancross](https://x.com/theiancross) on X. The repo itself is fully self-hostable from the docs at no cost.

## What's shipped (rough roadmap)

- **Stage 1 / M1–M11**: full Loom-shape product — recording flow, R2 multipart uploads, Deepgram pipeline, AI title/summary/chapters/action-items, share pages, comments, view tracking, trim + downloads, polish.
- **Stage 2 / G-M1–G-M17**: full Granola-shape product — audio capture, real-time transcripts, AI summaries, attendees, folder organization, multi-folder Phase 1, speaker recognition v1.
- **Stage 3**: security hardening — CSP, HSTS, signed Deepgram callbacks with single-use nonces, rate limits, time-bounded unlock cookies.
- **Stages 4–7**: macOS desktop app — premium composite recorder, Granola-grade visual shell, live notes side panel, pause/resume, orphan recovery.
- **Stage 8**: Granola-grade desktop note workspace.
- **Stage 9**: reliability — orphan recovery, Coolify brownout detection, boot-warmed pg-boss.
- **Migration tools**: Granola → Loomola CLI (`migrate/`) using the official Granola Business API. Imports notes, transcripts, summaries, attendees, folders, speaker attribution. Loom import is the next major build.

See [`ROADMAP.md`](ROADMAP.md) for the full status table.

## What's NOT here yet

- **Multi-tenant** / team accounts. Single-user today. Sign-up is invite-only on my live instance because I haven't built proper signup yet — the architecture supports it, the UX doesn't.
- **iOS / Android / Windows desktop**. macOS only for native capture. Web `/record` works on any Chrome.
- **Voice-biometric speaker recognition** ("here's Bhaskar's voice across all my recordings"). Spec'd, deferred. See [`docs/superpowers/specs/2026-05-04-speaker-recognition-design.md`](docs/superpowers/specs/2026-05-04-speaker-recognition-design.md).
- **Loom migration tool** — separate piece of work after the Granola migrator settles.
- **Custom share-page domains** per brand (`videos.acme.com → loomola`). Pairs with Brand Layer 2.

## Honest disclaimers

- **Single-user today.** If you sign up via the live instance you'll bounce off the auth wall. Self-hosting is the path. I'm gauging interest before deciding whether to flip multi-tenant.
- **Active dev.** I push to `main` directly because I'm solo. Things may break — the reliability sprint (Stage 9) was a response to a real production incident, see the commit log if you want the chess game. On the upside: I use this every day, which means it gets improvements continually just because I love working on it. No SLA promises, but the dev pace is real.
- **Not affiliated** with Loom, Atlassian, Granola, or Cap. Just a builder who doesn't want to pay $40/seat/month.
- **License: AGPL-3.0** — same as Cap. You can self-host freely. Anyone running a modified version as a hosted service must publish their changes. The paid walkthrough video is a separate product, not part of the AGPL-licensed code.

## Author

[Ian Cross](https://github.com/Deducer) — solo builder. Find me on X: [@theiancross](https://x.com/theiancross). Live instance: [loom.dissonance.cloud](https://loom.dissonance.cloud).

Issues + PRs welcome. I'm using this daily and contributing nearly every day, so things move; no formal guarantees but happy to entertain help, suggestions, or "this is broken in my setup" reports.
