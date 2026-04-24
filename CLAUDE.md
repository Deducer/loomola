# Loom Clone — Project Notes for Claude Code

**Owner:** Ian Cross  **Purpose:** Self-hosted screen recording platform replacing Loom's $20/mo subscription. Designed as a polymorphic media platform so future audio-based products (Granola-alt, MacWhisper-alt) share the backend.

## Session Start Checklist

1. Read `docs/superpowers/specs/2026-04-22-loom-clone-design.md` for the Stage 1 design
2. Read `docs/superpowers/plans/` for in-progress milestone plans
3. Check git log — understand what's been shipped vs. what's next
4. Do NOT commit `.env.local` (gitignored) — it contains Supabase service role key and Doppler service token

## Infrastructure References

| Resource | ID / URL | Notes |
|---|---|---|
| Production domain | `https://loom.dissonance.cloud` | Via Traefik on Hostinger VPS |
| GitHub repo | `https://github.com/Deducer/loom-clone` | Private, auto-deploys on push to `main` |
| Supabase project | `eghwhnxuvbguoayzdlof` (name: `loom-clone`) | Org `fpbgreogfejqrurxqnvq` (Dissonance Inc.), region `us-east-1` |
| Supabase dashboard | https://supabase.com/dashboard/project/eghwhnxuvbguoayzdlof | |
| Doppler project/config | `dissonance-cloud` → config `prd_loom` | Non-inheriting branch config; scoped to this app only |
| Coolify deployment | TBD (pending Task 18 manual step) | `loom.dissonance.cloud` |

## Creator User (single-user auth)

- Email: `theiancross@gmail.com`
- Initial password stored in `.env.local` as `TEST_CREATOR_PASSWORD` — user should reset via Supabase UI when convenient

## Stack

- **App:** Next.js 15 (App Router) + React 19 + TypeScript 5 + Tailwind CSS 4
- **DB + Auth:** Supabase (Postgres via `postgres` driver, Drizzle ORM for migrations; Auth via `@supabase/ssr`)
- **Background jobs (future):** `pg-boss` on the same Postgres; no Redis
- **Testing:** Vitest (unit) + Playwright (E2E golden paths)
- **Secrets:** Doppler CLI injected at container boot (`doppler run --`)
- **Container:** `node:22-alpine` multi-stage build, Next.js standalone output
- **Deployment:** Coolify on Hostinger VPS, Traefik for TLS + routing

## Future-milestone Services (not yet wired)

- **Video storage:** Cloudflare R2 (direct-from-browser multipart upload; zero egress)
- **Transcription:** Deepgram Nova with webhook callback
- **LLM:** Claude Sonnet 4.6 via Vercel AI SDK (provider-agnostic; swappable to GPT-4o-mini or Gemini)
- **Email:** Resend for comment notifications
- **Thumbnails:** system `ffmpeg` (apk-installed in the container, or `brew install ffmpeg` locally; override with `FFMPEG_PATH`)

## Milestone Roadmap (Stage 1)

See [`ROADMAP.md`](ROADMAP.md) for the live status table that Ian checks. Update that file when milestones ship. The list below is a stub for new-session context; defer to ROADMAP.md.


- [x] **M1: Foundation** — deployed auth-gated empty app (spec + plan in `docs/superpowers/`)
- [x] **M2: Data model + brand profiles CRUD** — full schema + `/brands` CRUD UI + top nav
- [x] **M3: Recording capture** — `/record` state machine, 5 parallel MediaRecorders, composite + raw tracks, local-only downloads.
- [x] **M3.1: Mic/camera device pickers** — dropdowns in pre-record form respect OS default fallback.
- [x] **M4: R2 upload + recordings list** — multipart streaming to R2, dashboard grid, /v/[slug] dual-mode share page.
- [x] **M5: Deepgram transcription** — pg-boss lazy-init, Deepgram async API, HMAC-signed webhook, transcripts in DB with word timestamps.
- [x] **M6: AI outputs + thumbnails** — webhook fans out 4 jobs (title_summary, chapters, action_items, thumbnail); Claude Sonnet 4.6 via Vercel AI SDK with Zod schemas; system ffmpeg (apk) reads from signed R2 URL; `flipToReadyIfComplete` idempotently transitions to ready.
- [x] **M7: Viewer page** — public `/v/:slug` with Plyr player, paragraph-synced transcript (click-to-seek + auto-scroll), chapter markers, signed-URL 403 refresh via `/api/v/:slug/refresh-url`, brand logo + accent in header.
- [x] **M8: Password protect + view tracking** — per-video bcrypt passwords, HMAC-signed slug-scoped unlock cookies (24h, auto-invalidated on password change), anonymous view tracking via sendBeacon, owner-only 10-bucket drop-off chart, view counts on dashboard + share page.
- [x] **M9: Comments** — anonymous timestamped comments on /v/:slug with name/email/body, auto-captured playhead, owner-only delete, per-visitor rate limit (3/5min), Mailgun notifications (MAILGUN_API_KEY + MAILGUN_DOMAIN=mg.dissonance.cloud + MAIL_FROM_ADDRESS), `#t=<sec>` deep-link seek on page load.
- [x] **M10: Trim editing + raw downloads** — owner-only trim editor with Save/Reset, PUT/DELETE /api/recordings/:id/trim, viewer-side playback clamp to [trim_start_sec, trim_end_sec], per-raw-track signed download links with Content-Disposition filenames.
- [x] **M11: Polish + full-pipeline smoke E2E** — `npm run smoke` runs the full pipeline via scripts/e2e-smoke.mjs; env pre-flight in src/lib/env-check.ts; boot summary in src/lib/boot-log.ts (hooked via src/db/index.ts); robots.txt + noindex meta on /v/:slug; log prefixes already normalized.
- [x] **Stage 1.5a: Design system + reskin** — CSS-var tokens, dark/light, Geist fonts, primitives under src/components/ui/, every surface rethemed.
- [x] **Stage 1.5b: Folders + search** — `folders` table (self-ref parent, FK cascade on owner, set-null on recording's folder_id), generated `search_tsv` columns with GIN indexes on media_objects/ai_outputs/transcripts (weighted A/B/C); FolderSidebar + SearchFilterBar + Breadcrumbs + drag-and-drop cards; card hover menu (move / delete). URL params (`?q=&sort=&folder=&status=&brand=`) drive dashboard state.

**Stage 1 + 1.5 complete.** Every feature outlined in the design spec (docs/superpowers/specs/2026-04-22-loom-clone-design.md) plus premium UX + organization is live at https://loom.dissonance.cloud.
- [ ] M9: Comments (V4) + Resend notifications
- [ ] M10: Trim editing + raw stream downloads
- [ ] M11: Polish + full-pipeline smoke E2E

After completing a milestone, re-invoke `superpowers:writing-plans` for the next one.

## Conventions

- **Deploy flow:** push to `main` → Coolify auto-deploys. No manual build step.
- **Database migrations:** Drizzle-generated SQL in `drizzle/`, applied at container boot by `scripts/migrate.ts`. Never hand-edit migration files.
- **Secrets:** anything sensitive in Doppler's `prd_loom` config; never in Coolify env vars directly. The only env var in Coolify is `DOPPLER_TOKEN`.
- **Branching:** Solo project. Direct pushes to `main` are expected. Protect only if/when collaborators join.
- **Testing:** E2E tests live in `tests/e2e/` and require `TEST_CREATOR_EMAIL` + `TEST_CREATOR_PASSWORD` env vars. Skipped in CI; run locally before big deploys.
- **Media object:** the data model's `media_objects` table is polymorphic (`type = 'video' | 'audio'`). Changes should preserve this abstraction — it's what lets future audio products share infrastructure.

## Known Risks (from spec)

- **Chrome-only system-audio capture** — acceptable for solo Chrome-using creator; becomes a problem if Stage 2 (macOS menubar app) isn't built before a non-Chrome use case emerges.
- **4K parallel MediaRecorder throughput** — validated in M3 milestone 0 before building more features. Fallback tiers documented in spec.
- **R2 signed URL mid-playback expiry** — refresh endpoint planned in M7.
- **No adaptive bitrate** — R2-direct serves one file; mobile-on-cellular viewers eat full composite. Mitigation deferred.
