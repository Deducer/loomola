# Loom Clone Roadmap

**Live at:** https://loom.dissonance.cloud

This is the single source of truth for what's shipped, what's in progress, and what's deferred. The full Stage 1 design (architecture, data model, open questions) lives in [`docs/superpowers/specs/2026-04-22-loom-clone-design.md`](docs/superpowers/specs/2026-04-22-loom-clone-design.md).

**Stage 1 status:** all 11 milestones shipped. Full pipeline — record → upload → transcribe → AI outputs → viewer page with password/comments/trim/downloads — is live and smoke-verified (`npm run smoke`).

## Status

| # | Milestone | Status | What it ships |
|---|---|---|---|
| M1 | Foundation | ✅ shipped | Deployed auth-gated empty app (Next.js + Supabase + Drizzle + Doppler + Coolify) |
| M2 | Data model + brand profiles | ✅ shipped | All 6 tables + RLS + `/brands` CRUD UI + top nav |
| M3 | Recording capture | ✅ shipped | `/record` state machine, 5 parallel MediaRecorders, composite + raw tracks, local-only downloads |
| M3.1 | Mic/camera device pickers | ✅ shipped | Dropdowns in pre-record form to choose mic + camera device; respects the user's choice instead of OS default |
| M4 | R2 upload + recordings list | ✅ shipped | 5-track multipart upload streaming from browser to R2, `media_objects` row per recording, dashboard grid, `/v/:slug` dual-mode share page |
| M5 | Deepgram transcription | ✅ shipped | pg-boss lazy-init, Deepgram async prerecorded API + HMAC-signed path-based webhook, transcripts persisted with word timestamps |
| M6 | AI outputs + thumbnails | ✅ shipped | 4 pg-boss jobs fanout after transcript (title/summary, chapters, action items, thumbnail); Claude Sonnet 4.6 via Vercel AI SDK with Zod schemas; system ffmpeg for JPG frame extraction |
| M7 | Viewer page | ✅ shipped | Public `/v/:slug` with Plyr player, 403-triggered signed-URL refresh, chapter markers on seek bar, paragraph-synced transcript with click-to-seek, action-items + chapters lists, brand Layer 1 theming (logo + accent) |
| M8 | Password protect + view tracking | ✅ shipped | Per-video bcrypt passwords with HMAC-signed 24h unlock cookies (auto-invalidated on password change); anonymous IP+UA hashed view tracking via sendBeacon; 10-bucket drop-off chart for owners; view count on dashboard cards |
| M9 | Comments | ✅ shipped | Anonymous timestamped comments on `/v/:slug` (name/email/body + auto-captured playhead), owner-only hard delete, 3-per-5min per-visitor rate limit, immediate Mailgun notifications with `#t=<sec>` deep-link back to the comment |
| M10 | Trim editing + raw downloads | ✅ shipped | Owner-only trim editor on /v/:slug (two-range-slider UI), player-side clamp to [trim_start_sec, trim_end_sec] via JS (no re-encoding); per-track signed download links with Content-Disposition filenames |
| M11 | Polish + full-pipeline smoke E2E | ✅ shipped | `npm run smoke` exercises the full Stage-1 pipeline (transcribe → AI → viewer → unlock → comment → trim → cleanup); env pre-flight diagnostic + boot summary log + robots/noindex on share pages |
| M3.2 | Movable bubble during recording | 💡 future | Drag the camera bubble to a new position mid-recording (not blocking shipping) |

## Not in Stage 1 (explicit scope fence)

Each of these gets its own spec + plan cycle when the time comes:

- **macOS menubar app** — native Swift + ScreenCaptureKit recorder hitting the same backend APIs
- **iOS app** — ReplayKit-based recording
- **Multi-tenant / team invites**
- **Brand profile Layers 2–5** — full page theming (Layer 2 is already the agreed near-term follow-up), custom CTAs, custom domains per brand, branded recorder UI
- **Full in-browser editor** — blur, middle-cuts, drawing, text overlays
- **AI Q&A chat** on a recording
- **Emoji reactions** on videos
- **Outbound webhooks** for automations
- **Granola-alt / audio-based capture** — reuses this backend's polymorphic `media_objects` schema; separate spec when we start it

## When to test

After each milestone ships, the `/record` flow (or relevant feature) goes live at https://loom.dissonance.cloud. I'll ping you explicitly when manual testing would be useful — typically:

- **New UI surfaces** — confirm layout and flows feel right
- **Hardware-dependent features** — anything involving camera/mic/screen devices
- **4K / performance milestones** — your M4 Pro is the reference hardware

Testing is not required between every commit — just at milestone boundaries.

## Stage 1.5 — Premium UX + Organization

| Phase | What it ships |
|-------|---------------|
| 1.5a  | CSS-var design tokens (dark + light via `next-themes`), Geist Sans/Mono, primitive components under `src/components/ui/`, every existing surface rethemed in the Linear/v0 aesthetic lane |
| 1.5b  | `folders` table with subfolders (single-parent hierarchy), Postgres FTS over title + AI title + summary + transcripts (weighted tsvector + GIN), sort/filter, sidebar dashboard layout, drag-and-drop recordings between folders, card hover-menu (move / delete) |

**Status:** ✅ shipped 2026-04-24. Primary dashboard now at `/?q=...&sort=...&folder=...&status=...&brand=...`. Theme toggle in top nav.

### Stage 1.5 polish follow-ups (candidate for Stage 1.6)

- ~~**Move creator controls off `/v/:slug`**~~ — ✅ shipped in Stage 1.6 (creator console at `/recordings/[id]/edit`).
- ~~**Redesign the drop-off chart**~~ — ✅ shipped in Stage 1.6 (filled-area SVG with hover percentile + viewer count).
- ~~**Declutter the share page vertical stack**~~ — ✅ shipped in Stage 1.6 (chapter segments on seekbar; summary / actions / chapters above tabs).
- **Loom-style trim handles on Plyr's seek bar** — still deferred. Different problem from chapter segments; lives in the trim UX rebuild.
- ~~**Inline creator edit affordances**~~ — ✅ shipped in Stage 1.6 (inline title rename, brand picker, type-to-confirm delete on the edit page).

## Stage 1.6 — Share page redesign + creator console

| What it ships |
|---|
| Watch-first share page: title → player (with Loom-style chapter segments painted on the seekbar) → AI summary → action items (auto-hide if empty) → chapters list → tabs (Transcript · Comments) with `?tab=` URL state. |
| Hard creator/visitor split: `/v/:slug` is purely a visitor surface (owner sees the same view + a small Edit pill in the brand header). All creator controls moved to a new `/recordings/[id]/edit` page. |
| Dashboard card click now lands on the edit page (creator-first), not the share page. |
| `/recordings/[id]/edit` is a sticky-preview two-column console: small Plyr preview on the left, sections on the right (Settings / Trim / Downloads / Analytics / Danger zone). |
| Inline title rename, brand reassignment, redesigned drop-off chart (smooth filled-area SVG with hover percentile + viewer count), type-to-confirm delete. |
| Bug fix: Chrome permission prompts now happen BEFORE the 3-2-1 countdown (previously: countdown → prompt → recording, now: prompt → countdown → recording). |
| Bug fix: `POST /api/recordings/:id/complete` now returns structured per-track error details on failure (was: opaque 500). |

**Status:** ✅ shipped 2026-04-26.

**Spec:** `docs/superpowers/specs/2026-04-25-share-page-redesign-design.md`
**Plan:** `docs/superpowers/plans/2026-04-25-share-page-redesign.md`

## Known gaps / bugs being tracked

See open issues: https://github.com/Deducer/loom-clone/issues
