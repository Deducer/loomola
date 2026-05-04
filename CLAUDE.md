# Loom Clone — Project Notes for Claude Code

**Owner:** Ian Cross  **Purpose:** Self-hosted screen recording platform replacing Loom's $20/mo subscription. Designed as a polymorphic media platform so future audio-based products (Granola-alt, MacWhisper-alt) share the backend.

**Live:** https://loom.dissonance.cloud

## Multi-product strategy

This repo hosts **two products on one codebase**, gated by a single env flag:

- **Loom** — always built. The screen-recording product covered by this CLAUDE.md.
- **Granola** — built into the same `main` branch behind `ENABLE_GRANOLA=true`. When the flag is `false` (default), Notes routes return 404, the Notes dashboard tab is hidden, and audio-only `media_objects` rows are inert. When `true`, both products run on the same Postgres / R2 / Mailgun / Auth.

**Why one repo, one branch?** The schema is already polymorphic (`media_objects.type = 'video' | 'audio'`); the pipeline (Deepgram → Claude → pg-boss) doesn't care about media type; folders / search / brand profiles / comments / sharing / view tracking are polymorphic-by-construction. A long-lived `granola` feature branch would diverge painfully on migrations alone. A fork would force every Loom fix to be cherry-picked forever.

**For shipping pure Loom** (e.g., to a different user who only wants the screen-recording product): deploy from the `loom-v1.0` git tag (or any later commit) with `ENABLE_GRANOLA=false`. They'll never see Granola UI or routes.

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
| Mailgun | `MAILGUN_API_KEY`, `MAILGUN_DOMAIN=mg.dissonance.cloud`, `MAIL_FROM_ADDRESS` (Doppler) | Used for new-comment + first-view-per-visitor notifications to recording owner |
| Feature flag: `ENABLE_GRANOLA` | Doppler (`prd_loom`) | `'true'` enables the Granola product (audio meeting notes) on top of Loom. `'false'` / unset = Loom-only. Read by every server-side gate; client UI hides Notes-tab when false. Set per-deploy. |

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
- **Recording:** Browser MediaRecorder x5 (composite + screen + camera + mic + system-audio raw tracks). Compositor runs in a Web Worker (`composite.worker.ts`) using `MediaStreamTrackProcessor` + `OffscreenCanvas` + `MediaStreamTrackGenerator` so it survives /record being a background tab. The worker only does screen aspect-fit + letterbox — the bubble is **not** drawn into the composite; the Chrome extension injects a `/bubble` iframe into every tab (including /record), and that iframe lives in the screen pixels `getDisplayMedia` already gives us. Single source of truth for the on-screen bubble.
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
- `/record` — recording flow: pre-record form → preparing (permissions) → 3-2-1 countdown → recording → uploading → finished. The bubble is rendered by the Chrome extension companion (`extension/`), which injects a frameless `/bubble` iframe into every tab the user is on. Drag updates the iframe's `left/top` and posts a fractional position back to /record via the extension's message bridge; that position is also persisted in `chrome.storage.session` so the iframe respawns at the same spot when the user switches tabs.
- `/v/:slug` — visitor share page. Watch-first: title → player (Loom-style chapter segments + hover-scrub thumbnails) → AI summary → action items → chapters list → tabs (Transcript · Comments). Brand-themed when a brand profile is assigned (logo + accent + tagline + custom Google Font + CTA pill + footer text).
- `/recordings/[id]/edit` — creator console. Sticky preview on the left, settings + trim + downloads + analytics + danger-zone on the right (capped at 360px so the video gets the lion's share of the page).
- `/brands` — brand profile CRUD with full Layer 2 theming fields.
- `desktop/` — native macOS companion app early dev build. It can sign in, list capture sources, show a live camera bubble, and upload a first-display MP4 as the `composite` track through the existing backend. It does **not** yet composite the bubble into exported video or upload raw tracks. Spec: [`docs/superpowers/specs/2026-04-27-macos-desktop-app-design.md`](docs/superpowers/specs/2026-04-27-macos-desktop-app-design.md). Plan: [`docs/superpowers/plans/2026-04-27-macos-desktop-app.md`](docs/superpowers/plans/2026-04-27-macos-desktop-app.md).

## Conventions

- **Deploy flow:** push to `main` → Coolify rebuilds → migrations run automatically at container boot (`scripts/migrate.ts`).
- **Migrations:** Drizzle-generated SQL in `drizzle/`. Never hand-edit committed migrations; create a new one. The journal at `drizzle/meta/_journal.json` must list every committed `.sql` file.
- **Secrets:** Doppler `prd_loom`. Never put a secret in code, in Coolify env vars, or in `.env*` committed files.
- **Tests:** unit must pass; the pre-existing `ai-schemas.test.ts > rejects negative timestamps` failure is unrelated to current work and tracked but not blocking. E2E requires the dev server running + `TEST_CREATOR_*` env vars.
- **Polymorphic media:** `media_objects.type` is `'video' | 'audio'`. Preserve this abstraction — it's what lets future audio products share infra.
- **Code style:** existing surface uses CSS-var tokens (`--accent`, `--text`, `--bg-subtle`, etc.) — don't introduce ad-hoc hex colors. Components follow `class-variance-authority` for variant systems where useful.

## Security posture

Stage 3 (security hardening pack, shipped 2026-05-04) brought the app to a posture that survives a first-pass external review:

- **HTTP security headers everywhere.** `src/lib/security/headers.ts` is invoked from `src/middleware.ts` for every response — sets CSP (frame-ancestors `'self'`), HSTS (2-year preload), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, `X-Frame-Options: SAMEORIGIN`. The `/bubble` route is special-cased with `allowFraming: true` so the Chrome-extension iframe can be embedded into any tab.
- **Time-bound unlock cookies.** `src/lib/viewer/unlock-cookie.ts` signs `slug:passwordHash:issuedAt` and rejects > 24 h old, future-dated, tampered, or empty.
- **Deepgram callback nonce.** Single-use nonces persisted in `webhook_nonces`, atomically consumed via `UPDATE ... WHERE consumed_at IS NULL AND expires_at > now()`. Webhook URL shape: `/api/webhooks/deepgram/[recordingId]/[nonce]/[sig]`. Tests cover replay rejection, expiry, tamper, mismatched recording id, never-issued nonce.
- **Persistent rate limits.** `src/lib/rate-limit/check.ts` (sliding-window over `rate_limit_events`) is shared by comment posts (3/5min/visitor) and password unlock attempts (5/5min/visitor). The pure decision lives in `src/lib/rate-limit/evaluate.ts` for testability. Opportunistic 1%-of-allowed cleanup keeps the table small without a cron.
- **Desktop Keychain-only.** `desktop/Sources/LoomDesktopApp/Auth/AuthSessionStore.swift` no longer falls back to plaintext-file storage based on bundle path. `.fileForTesting` mode survives only as a unit-test seam.

When adding a new public-facing endpoint that accepts user input, default to `checkRateLimit({ scope: '<endpoint>:visitor', key: hashVisitor(req), max, windowSec })`.

## Known Issues / Quirks

- **Chrome-only by design** — `getDisplayMedia` system-audio capture is Chrome-only; the worker compositor uses `MediaStreamTrackProcessor` / `MediaStreamTrackGenerator` (Chrome 94+). Safari/Firefox aren't supported. The bubble extension is also Chrome MV3 only.
- **Extension reload protocol** — when iterating on `extension/`, after pushing the change reload the extension at `chrome://extensions` (manifest version is bumped on each set of changes specifically so this is visible) AND close any tabs that were open during the previous extension lifetime. Old "orphan" content scripts keep running in already-open tabs and they share the page with the freshly-injected new script — `safeSendMessage` is hardened to no-op when context is dead, but tabs are cleaner with the orphan gone entirely.
- **No adaptive bitrate** — R2 serves one composite file; mobile/cellular viewers eat the full bitrate. Deferred.
- **`ai-schemas.test.ts > rejects negative timestamps`** — fails (pre-existing); minor schema gap, not blocking.
- **Mobile** — designed desktop-first. No focused mobile pass yet; share page renders OK below 768px but not battle-tested.
- **Brand `fontFamily` is Google Fonts only** — the share page injects `<link href="https://fonts.googleapis.com/css2?family=<name>:wght@400;500;600;700">` and applies the family page-wide. Foundry/commercial fonts (Söhne, TT Norms, Pangram Pangram "Test ..." trial fonts, etc.) silently 404 and fall back to the system sans. Custom-font upload (R2 + `@font-face`) is the right next step but not built yet.

## Speaker recognition (G-M13 v1 shipped 2026-05-04; Path C deferred)

After `generate_title_summary` completes for an **audio note** that has attendee data, a `suggest_speakers` pg-boss job auto-suggests `speaker_idx → person` mappings using `media_objects.attendees` + the new `people.is_self` flag. ✓ accepts (creates a Person inline if needed); ✗ dismisses with a sticky lock. Pill UX shaped after G-M12 folder suggestion. Pure logic in `src/lib/speaker-suggestion/` (35 unit tests).

**v1 (Path B) limitations to be aware of when extending:**
- Audio-only. Worker explicitly filters `type === "audio"` because the speaker-labeling UI in `transcript-panel.tsx` only exists for audio notes today. Video gets the same flow when a creator-side video transcript surface is added.
- Strict-only matching: speaker_count == attendee_count + 1, and self-detection requires > 5% margin in total speech. When numbers don't line up the worker no-ops rather than guessing.
- Runs once per recording; controlled by the unique index on `(media_object_id, speaker_idx)`.

**v2 (Path C, deferred):** voice biometrics. Per-speaker voice embeddings on `people` rows; cosine match identifies same voice across recordings. Tech-stack choice (Pyannote / SpeechBrain / Resemblyzer / AssemblyAI) deliberately deferred until v1 has lived for ≥ 2 weeks.

- Spec: `docs/superpowers/specs/2026-05-04-speaker-recognition-design.md`
- v1 plan: `docs/superpowers/plans/2026-05-04-speaker-recognition-v1-attendee-match.md`
- New schema: `speaker_assignments.is_suggestion`, `suggested_at`, `dismissed_at`, `suggested_new_person_payload`; `people.is_self` (partial unique index).
- API: `POST /api/recordings/[id]/speaker-suggestions/{accept,dismiss}`.

## Folder suggestion (G-M12, shipped 2026-05-04)

After `generate_title_summary` finishes for any recording (Loom or Granola) that arrived with no `folder_id`, a `suggest_folder` pg-boss job runs the user's note + their existing folders through Haiku 4.5 and persists `media_objects.suggested_folder_id` only when the model returns `confidence === "high"` AND the suggested folder is in the user's actual folder list (hallucination defense).

- **Schema columns:** `suggested_folder_id`, `suggested_folder_at`, `suggested_folder_dismissed_at` on `media_objects` (migration `0019_folder_suggestion.sql`).
- **UI:** `<FolderSuggestionPill />` renders on dashboard cards (both `recording-card.tsx` and `notes-list.tsx`) when `suggested_folder_id` is set and the user hasn't already filed it. ✓ accepts → `toast.success` via the already-mounted `<Toaster position="bottom-right" />`. ✗ dismisses with a sticky lock that's cleared on AI regen.
- **Classifier model:** `LLM_CLASSIFIER_MODEL` env var (defaults to `claude-haiku-4-5-20251001`). Optional `LLM_CLASSIFIER_PROVIDER` falls back to `LLM_PROVIDER`.
- **Cost:** ~$0.005 per note. Job is best-effort; failures never block the title/summary write.
- **Realtime:** suggestions appear on next page load — no client-side realtime subscription on the dashboard yet. That's a follow-up polish.

## Granola-alt (in progress)

A second product (audio meeting notes) built on top of this same backend. Spec: [`docs/superpowers/specs/2026-04-28-granola-clone-design.md`](docs/superpowers/specs/2026-04-28-granola-clone-design.md).

- **G-M1 shipped:** six new Postgres tables (`notes`, `people`, `speaker_assignments`, `dictionary_terms`, `transcript_chunks`, `summary_embeddings`), four extended tables (`media_objects`, `transcripts`, `ai_outputs`, `brand_profiles`), pgvector extension, HNSW vector indexes, RLS policies, Supabase Realtime publication on `ai_outputs`, and thin CRUD API routes for the new entities.
- **Schema additions you'll see:** `media_objects.attendees` (jsonb of person UUIDs), `media_objects.r2MixedKey` (mic+system mixed mono audio), `media_objects.meetingDetectedApp`, `media_objects.sourceContextHint`, `media_objects.obsidianSyncedAt`, `transcripts.provider` (default `deepgram`), `ai_outputs.generationStatusValue` (`pending|streaming|complete|failed`), `brand_profiles.meetingNotesVaultPath`.
- **No UI yet** — that lands in G-M4 (`/notes/:id`) and G-M5 (tabbed dashboard).
- **Feature flag:** every Granola API route checks `ENABLE_GRANOLA === 'true'`. When false / unset, the routes return 404 and Loom-only deploys stay dark.
- **Provider abstraction:** env vars `LLM_PROVIDER`, `LLM_MODEL`, `EMBEDDING_PROVIDER`, `TRANSCRIBE_PROVIDER` allow swapping providers without code changes.
- **`INTEGRATION_API_TOKEN`:** bearer token for upcoming LLM-accessible export endpoints (lands in G-M11). Do NOT expose this in client code; server-only.

## Out-of-Stage-1 Scope (deferred, separate spec when picked up)

- macOS menubar / desktop app implementation (native, ScreenCaptureKit on macOS) — spec + scaffold exist under `docs/superpowers/specs/2026-04-27-macos-desktop-app-design.md`, `docs/superpowers/plans/2026-04-27-macos-desktop-app.md`, and `desktop/`.
- iOS / Android apps
- Multi-tenant / team invites
- Custom domains per brand (Layer 2 follow-up)
- AI Q&A chat on a recording
- Emoji reactions
- Outbound webhooks
- Granola-alt (audio capture) — reuses the polymorphic media_objects table

## Working with Claude Code on this repo

- This file is for *your* context. The companion file `AGENTS.md` mirrors it for Codex/non-Claude-Code agents.
- Use the `superpowers:*` skill family for big features (brainstorm → write spec → write plan → execute via subagents). For small fixes, just go.
- Prefer editing existing files over creating new ones. Don't write speculative documentation.
- The user's CLAUDE.md priority instruction: *no premature abstraction; three similar lines is better than a helper.* Don't add JSDoc unless WHY is non-obvious. Don't add error handling for impossible cases.
