# Loom Clone — Project Notes for Codex / non-Claude-Code agents

**Owner:** Ian Cross  **Purpose:** Self-hosted screen recording platform replacing Loom's $20/mo subscription. Designed as a polymorphic media platform so future audio-based products (Granola-alt, MacWhisper-alt) share the backend.

**Live:** https://loom.dissonance.cloud

## Session Start Checklist

1. Read [`ROADMAP.md`](ROADMAP.md) for what's shipped + what's open.
2. `git log --oneline -20` to see recent commits.
3. Check `docs/superpowers/specs/` and `docs/superpowers/plans/` for any in-progress milestone.
4. **Do NOT commit `.env.local`** (gitignored) — it holds the Doppler service token + Supabase service-role key.
5. **Direct pushes to `main` are expected** (solo project, Coolify auto-deploys on push).

## Infrastructure References

| Resource | Where | Notes |
|---|---|---|
| Production domain | `https://loom.dissonance.cloud` | Coolify on Hostinger VPS, Traefik for TLS + routing |
| GitHub repo | https://github.com/Deducer/loom-clone | Private; push to `main` → Coolify rebuilds + deploys |
| Coolify | (manual UI on the VPS) | Container env contains only `DOPPLER_TOKEN`; everything else is injected at boot |
| Doppler project / config | `dissonance-cloud` → `prd_loom` | Non-inheriting branch config scoped to this app only |
| Supabase project | `eghwhnxuvbguoayzdlof` (`loom-clone`) | Org: Dissonance Inc. (`fpbgreogfejqrurxqnvq`), region `us-east-1` |
| Supabase dashboard | https://supabase.com/dashboard/project/eghwhnxuvbguoayzdlof | |
| Cloudflare R2 | bucket configured via `R2_BUCKET` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_ACCOUNT_ID` / `R2_ENDPOINT` | All five are in Doppler |
| Deepgram | `DEEPGRAM_API_KEY` (Doppler) | Async prerecorded API + HMAC-signed webhook back to `/api/webhooks/deepgram/[recordingId]/[sig]` |
| Anthropic (Claude) | `ANTHROPIC_API_KEY` (Doppler) | Sonnet 4.6 via Vercel AI SDK; provider-agnostic (swappable) |
| Mailgun | `MAILGUN_API_KEY`, `MAILGUN_DOMAIN=mg.dissonance.cloud`, `MAIL_FROM_ADDRESS` (Doppler) | Used for new-comment notifications to recording owner |

## Creator User (single-user auth today)

- Email: `theiancross@gmail.com`
- Initial password stored in `.env.local` as `TEST_CREATOR_PASSWORD` — reset via Supabase UI when convenient.
- Multi-tenant / team invites is explicitly out of Stage 1 scope.

## Stack

- **App:** Next.js 15 (App Router) + React 19 + TypeScript 5 + Tailwind CSS 4 (CSS-var tokens, dark/light via `next-themes`).
- **DB + Auth:** Supabase (Postgres via `postgres` driver; Drizzle ORM for schema + migrations; Auth via `@supabase/ssr`).
- **Background jobs:** `pg-boss` on the same Postgres (no Redis). Lazy-init via `getBoss()` — first send creates the queues. 6 queues: `transcribe`, `title_summary`, `chapters`, `action_items`, `thumbnail`, `preview_sprite`.
- **Object storage:** Cloudflare R2 (S3-compatible). Browser → R2 multipart upload via signed-URL-per-part flow (see `src/lib/r2/`). Zero egress (R2 free tier on reads).
- **Player:** Plyr 3.x wrapping `<video>`. Custom `ChapterSegmentsOverlay` portaled to `document.body`. Hover-scrub previews via Plyr's `previewThumbnails` config + a server-served WebVTT.
- **Recording:** Browser MediaRecorder x5 (composite + screen + camera + mic + system-audio raw tracks). Compositor canvas (`composite-canvas.ts`) draws screen + bubble for the composite. Bubble position is mutable mid-recording via a `BubblePositionController` ref.
- **Testing:** Vitest (unit) under `tests/unit/`, Playwright (E2E) under `tests/e2e/` (skipped without `TEST_CREATOR_*` env vars).
- **Container:** `node:22-alpine` multi-stage build, Next.js standalone output, system `ffmpeg` apk-installed for the thumbnail + sprite jobs.
- **Secrets:** Doppler CLI injected at boot (`doppler run -- node ...`). Never put env vars directly in Coolify except `DOPPLER_TOKEN`.

## External Services (all wired and live in prod)

| Service | What it does | Status |
|---|---|---|
| **Cloudflare R2** | Stores composite + raw video tracks + thumbnails + preview sprites + brand logos | ✅ wired |
| **Deepgram** | Transcribes audio (prerecorded API), HMAC-signed webhook fan-out kicks off AI jobs | ✅ wired |
| **Anthropic Claude** | Generates AI title, summary, chapters, action items via Vercel AI SDK + Zod schemas | ✅ wired (Sonnet 4.6) |
| **Mailgun** | Sends notification email to recording owner when someone comments | ✅ wired |
| **system ffmpeg** | Extracts thumbnail at t=1s + builds preview-sprite sheet for hover-scrub | ✅ wired (apk in container) |

## Milestones (live status: see [`ROADMAP.md`](ROADMAP.md))

Stage 1 (M1–M11) + Stage 1.5a/b + Stage 1.6 + Stage 1.7 + Stage 1.8 all shipped. Big-picture surface area:

- `/` — dashboard with folder sidebar, search, sort/filter, drag-and-drop card-to-folder, hover card menu (Edit / Move / Delete). Cards click into the **edit** page (creator-first), not the share page.
- `/record` — recording flow: pre-record form → preparing (permissions) → 3-2-1 countdown → recording → uploading → finished. Bubble can be dragged anywhere on screen during recording (Chrome `documentPictureInPicture` window with the live camera).
- `/v/:slug` — visitor share page. Watch-first: title → player (Loom-style chapter segments + hover-scrub thumbnails) → AI summary → action items → chapters list → tabs (Transcript · Comments). Brand-themed when a brand profile is assigned (logo + accent + tagline + custom Google Font + CTA pill + footer text).
- `/recordings/[id]/edit` — creator console. Sticky preview on the left, settings + trim + downloads + analytics + danger-zone on the right (capped at 360px so the video gets the lion's share of the page).
- `/brands` — brand profile CRUD with full Layer 2 theming fields.
- `desktop/` — native macOS companion app scaffold. The implementation spec is [`docs/superpowers/specs/2026-04-27-macos-desktop-app-design.md`](docs/superpowers/specs/2026-04-27-macos-desktop-app-design.md) and the build plan is [`docs/superpowers/plans/2026-04-27-macos-desktop-app.md`](docs/superpowers/plans/2026-04-27-macos-desktop-app.md). It is spec'd, ready to build, and should remain a record/upload client that reuses the existing Next.js API + R2 + Supabase pipeline.

## Conventions

- **Deploy flow:** push to `main` → Coolify rebuilds → migrations run automatically at container boot (`scripts/migrate.ts`).
- **Migrations:** Drizzle-generated SQL in `drizzle/`. Never hand-edit committed migrations; create a new one. The journal at `drizzle/meta/_journal.json` must list every committed `.sql` file.
- **Secrets:** Doppler `prd_loom`. Never put a secret in code, in Coolify env vars, or in `.env*` committed files.
- **Tests:** unit must pass; the pre-existing `ai-schemas.test.ts > rejects negative timestamps` failure is unrelated to current work and tracked but not blocking. E2E requires the dev server running + `TEST_CREATOR_*` env vars.
- **Polymorphic media:** `media_objects.type` is `'video' | 'audio'`. Preserve this abstraction — it's what lets future audio products share infra.
- **Code style:** existing surface uses CSS-var tokens (`--accent`, `--text`, `--bg-subtle`, etc.) — don't introduce ad-hoc hex colors. Components follow `class-variance-authority` for variant systems where useful.

## Known Issues / Quirks

- **Chrome-only by design** — `getDisplayMedia` system-audio capture is Chrome-only; Document PiP is Chrome-only. Safari/Firefox would partially work (no system audio, no floating bubble).
- **Recording the entire screen + bubble pip** — the bubble pip window is itself visible in a full-screen capture (along with Chrome's small window-chrome titlebar on the pip). For tab/window recordings it's invisible to the capture. The cleanest fix would be a Chrome extension that injects a true frameless circle bubble as a content-script DOM element in the captured tab — that's how Loom does it for the web.
- **No adaptive bitrate** — R2 serves one composite file; mobile/cellular viewers eat the full bitrate. Deferred.
- **`ai-schemas.test.ts > rejects negative timestamps`** — fails (pre-existing); minor schema gap, not blocking.
- **Mobile** — designed desktop-first. No focused mobile pass yet; share page renders OK below 768px but not battle-tested.

## Out-of-Stage-1 Scope (deferred, separate spec when picked up)

- Chrome extension companion (frameless circle bubble — see "Known Issues")
- macOS menubar / desktop app implementation (native, ScreenCaptureKit on macOS) — spec + scaffold exist under `docs/superpowers/specs/2026-04-27-macos-desktop-app-design.md`, `docs/superpowers/plans/2026-04-27-macos-desktop-app.md`, and `desktop/`.
- iOS / Android apps
- Multi-tenant / team invites
- Custom domains per brand (Layer 2 follow-up)
- AI Q&A chat on a recording
- Emoji reactions
- Outbound webhooks
- Granola-alt (audio capture) — reuses the polymorphic media_objects table

## Working on this repo (Codex / non-Claude-Code agents)

- This file is for *your* context. The companion file `CLAUDE.md` is the same content for Claude Code sessions.
- For big features, brainstorm requirements with the user first, then write a spec to `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`, then a plan to `docs/superpowers/plans/YYYY-MM-DD-<topic>.md`, then execute. For small fixes, just go.
- Prefer editing existing files over creating new ones. Don't write speculative documentation.
- The user's repo policy: *no premature abstraction; three similar lines is better than a helper.* Don't add JSDoc unless the WHY is non-obvious. Don't add error handling for impossible cases. Don't add comments that say WHAT — only WHY.
- Direct pushes to `main` are expected. Coolify deploys on push.
