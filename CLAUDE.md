> # 🚦 Setting up your OWN copy of Loomola? Do NOT follow this file — go to the [README](README.md).
>
> **This file is the maintainer's operational brief for the live production instance.** It assumes you are contributing to the codebase or operating `loom.dissonance.cloud`. If you are a **self-hoster** standing up your own copy — or an **AI assistant helping one** — then everything below about **Doppler, Coolify, pushing to `main`, the specific Supabase project id, the maintainer's domain/email, and `npm run smoke` / `npm run mcp-smoke`** does **NOT** apply to you. It will actively mislead a fresh setup.
>
> **What to do instead:** follow **[README.md → "Self-host Quickstart"](README.md#self-host-quickstart)**. Create your own fresh accounts and keys. Do **not** push to this repo's `main`, do **not** deploy to or reference the maintainer's infrastructure, and do **not** copy the maintainer's `.env.local`. For a brand-new instance, "Quickstart A — Docker Compose" with a free Supabase project is the path.
>
> Everything from the heading below is maintainer-only context.

---

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

- Email: `<owner-email — see git config>`
- Initial password stored in `.env.local` as `TEST_CREATOR_PASSWORD` — reset via Supabase UI when convenient.
- Multi-tenant / team invites is explicitly out of Stage 1 scope.

## Stack

- **App:** Next.js 15 (App Router) + React 19 + TypeScript 5 + Tailwind CSS 4 (CSS-var tokens, dark/light via `next-themes`).
- **DB + Auth:** Supabase (Postgres via `postgres` driver; Drizzle ORM for schema + migrations; Auth via `@supabase/ssr`).
- **Background jobs:** `pg-boss` on the same Postgres (no Redis). Lazy-init via `getBoss()` — first send creates the queues. Queues: `transcribe`, `title_summary`, `chapters`, `action_items`, `thumbnail`, `preview_sprite`, `transcode_playback`, `append_clip`, `watchdog_stuck_recordings`, `purge_deleted` (+ Granola-only: `mix_audio`, `audio_waveform`, `embed_transcript`, `embed_summary`, `suggest_folder`, `suggest_speakers`). `watchdog` (10min) and `purge_deleted` (daily) are boss.schedule crons.
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

Stage 1 (M1–M11) + Stages 1.5–1.10 + 1.99 + Stage 2 (G-M1–M17, except v2 voice biometrics) + Stage 3 (security) + Stage 4 (desktop M2 premium recorder) + Stage 5 (desktop M3 visual restructure) + Stage 6 (live notes) + Stage 7 (stability + Granola UX + multi-folder Phase 1) + Stage 8 (Granola-grade desktop note workspace) + Stage 9 (reliability sprint: orphan recovery + boot-warmed pg-boss + brownout detection) + Stage 10 (open-source readiness: compose+MinIO, doctor, first-run+invites+reset, failure UX+watchdog+retry, real /api/health, boot-warm attempt 2, whisper provider, configurable extension 0.9.0, release workflows, v1.0.0) + Stage 11 (cost + trust sprint: mono+diarize transcription at half the Deepgram bill, real trash + daily purge reaper reclaiming R2/DB storage, processing-status liveness on every web surface, XFF rate-limit fix, audio-note retry on web) + Stage 12 (desktop auth reliability: single-refresh-authority auth with no SupabaseClient, mid-recording token keep-alive, auto-retry Recovery after sign-in, honest signed-out readiness, upload-path transient retries, audio-title lifecycle fix) + Stage 13 (trust sprint II: video orphan recovery, watchdog failure-alert emails, live-transcription reconnect with backoff, echo-dedup sidechain duck in mix_audio, merged single-call video AI outputs, recent-list pagination) + Stage 14 (Granola-parity desktop surfaces: suggested-folder banner with ⌘↩ accept, speaker-name preview + one-click apply in the transcript drawer, My notes / Enhanced split panes that stop generation overwriting raw notes) + Stage 15 (sidebar favorites + per-folder emoji icons, desktop) all shipped. Big-picture surface area:

- `/` — dashboard with folder sidebar, search, sort/filter, drag-and-drop card-to-folder, hover card menu (Edit / Move / Delete). Cards click into the **edit** page (creator-first), not the share page.
- `/record` — recording flow: pre-record form → preparing (permissions) → 3-2-1 countdown → recording → uploading → finished. The bubble is rendered by the Chrome extension companion (`extension/`), which injects a frameless `/bubble` iframe into every tab the user is on. Drag updates the iframe's `left/top` and posts a fractional position back to /record via the extension's message bridge; that position is also persisted in `chrome.storage.session` so the iframe respawns at the same spot when the user switches tabs.
- `/v/:slug` — visitor share page. Watch-first: title → player (Loom-style chapter segments + hover-scrub thumbnails) → AI summary → action items → chapters list → tabs (Transcript · Comments). Brand-themed when a brand profile is assigned (logo + accent + tagline + custom Google Font + CTA pill + footer text). Public links emit Open Graph/Twitter metadata and a stable `/api/v/:slug/thumbnail.jpg` route for Slack/Discord unfurls; password-protected, not-ready, missing, or thumbnail-less recordings fall back to a generic Loomola image.
- `/recordings/[id]/edit` — creator console. Sticky preview on the left, settings + trim + downloads + analytics + danger-zone on the right (capped at 360px so the video gets the lion's share of the page).
- `/brands` — brand profile CRUD with full Layer 2 theming fields.
- `desktop/` — native macOS companion app, **production-grade**. Stages 4 (premium recorder), 5 (Granola-grade visual shell), 6 (live notes side panel + pause/resume), 7 (stability + Granola UX), 8 (Granola-grade audio note workspace) all shipped. Builds via `desktop/scripts/install-local-app.sh` (release `.app` → ad-hoc signed → `/Applications/Loomola.app`). Composite recorder via AVAssetWriter + CIContext. Audio note flow uses AVAudioFile (post-Stage-7 rewrite — bypasses an AVFCore bug on macOS 26.4.1). Auth tokens in file storage by default (Stage 7). Logger-based observability (`subsystem: cloud.dissonance.loom.desktop`). One-window content-swap architecture as of Stage 8 (`MainRecorderView.noteTarget` swaps home ↔ workspace; the `NotesSidePanelWindowController` NSPanel approach was retired). Toolbar items live in the unified system NSToolbar via SwiftUI's `.toolbar { ToolbarItem(...) }` API. Specs: [`2026-04-27-macos-desktop-app-design.md`](docs/superpowers/specs/2026-04-27-macos-desktop-app-design.md), [`2026-05-04-desktop-app-m2-premium-recorder-design.md`](docs/superpowers/specs/2026-05-04-desktop-app-m2-premium-recorder-design.md), [`2026-05-04-desktop-app-m3-visual-restructure-design.md`](docs/superpowers/specs/2026-05-04-desktop-app-m3-visual-restructure-design.md).

## Conventions

- **Deploy flow:** push to `main` → Coolify rebuilds → migrations run automatically at container boot (`scripts/migrate.ts`).
- **Migrations:** Drizzle-generated SQL in `drizzle/`. Never hand-edit committed migrations; create a new one. The journal at `drizzle/meta/_journal.json` must list every committed `.sql` file.
- **Secrets:** Doppler `prd_loom`. Never put a secret in code, in Coolify env vars, or in `.env*` committed files.
- **Tests:** unit must pass. E2E requires the dev server running + `TEST_CREATOR_*` env vars.
- **Polymorphic media:** `media_objects.type` is `'video' | 'audio'`. Preserve this abstraction — it's what lets future audio products share infra.
- **Code style:** existing surface uses CSS-var tokens (`--accent`, `--text`, `--bg-subtle`, etc.) — don't introduce ad-hoc hex colors. Components follow `class-variance-authority` for variant systems where useful.

## Security posture

Stage 3 (security hardening pack, shipped 2026-05-04) brought the app to a posture that survives a first-pass external review:

- **HTTP security headers everywhere.** `src/lib/security/headers.ts` is invoked from `src/middleware.ts` for every response — sets CSP (frame-ancestors `'self'`), HSTS (2-year preload), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, `X-Frame-Options: SAMEORIGIN`. The `/bubble` route is special-cased with `allowFraming: true` so the Chrome-extension iframe can be embedded into any tab.
- **Time-bound unlock cookies.** `src/lib/viewer/unlock-cookie.ts` signs `slug:passwordHash:issuedAt` and rejects > 24 h old, future-dated, tampered, or empty.
- **Deepgram callback nonce.** Single-use nonces persisted in `webhook_nonces`, atomically consumed via `UPDATE ... WHERE consumed_at IS NULL AND expires_at > now()`. Webhook URL shape: `/api/webhooks/deepgram/[recordingId]/[nonce]/[sig]`. Tests cover replay rejection, expiry, tamper, mismatched recording id, never-issued nonce.
- **Persistent rate limits.** `src/lib/rate-limit/check.ts` (sliding-window over `rate_limit_events`) is shared by comment posts (3/5min/visitor) and password unlock attempts (5/5min/visitor). The pure decision lives in `src/lib/rate-limit/evaluate.ts` for testability. Opportunistic 1%-of-allowed cleanup keeps the table small without a cron.
- **Desktop auth storage — file by default, Keychain on opt-in (revised in Stage 7, 2026-05-06).** Stage 3 originally locked production to Keychain; six install/relaunch cycles per testing session re-prompted for the macOS login password every time, which made iteration unworkable. The default flipped from `.keychain` → `.file` (`~/Library/Application Support/LoomDesktop/auth-session.json`, 0600 perms). Threat-model wise this is no weaker than Keychain for a single-user dev tool — anyone with the macOS account can read the Keychain anyway. The Stage-3 reasoning that mattered (no path-based silent fallback based on bundle path) still holds: file is now the explicit default, not a heuristic. Mode is selectable via `AuthSessionStore(storageMode: .keychain)` if a future multi-user Mac scenario calls for it.
- **Desktop auth — single refresh authority, no SupabaseClient (Stage 12, 2026-07-07).** `DesktopAuthService` talks to Supabase's REST auth endpoints directly (password grant, refresh_token grant, logout) and is the ONLY consumer of the refresh token. The SDK client it used to construct defaulted to `autoRefreshToken: true` and ran a second refresh loop (started on every app-becomes-active) against a private in-memory session copy; Supabase rotates refresh tokens per use and revokes the whole family on reuse, so the two refreshers eventually burned each other's tokens — the root cause of every "Saved sign-in expired" upload failure (confirmed live: `refresh_token_already_used`, 2026-07-07 incident, 111-min recording). If that error ever recurs, hunt for a NEW second refresher: the only permitted SupabaseClient in `desktop/` is `ObsidianRealtimeSubscriber`'s, and only with the `auth: .init(accessToken:)` closure mode, which never refreshes. Defense in depth from the same stage: 10-min keep-alive refresh during recordings, sign-in-now banner on hard refresh failure mid-call, auto-retry of Recovery orphans after sign-in, and transient-retry on start/part-url/complete.
- **Open-redirect fix (Stage 10, 2026-06-09).** Auth callback `?next=` parameter is now validated against same-origin paths only — absolute URLs, `//evil.com`, `/\evil.com` shapes are rejected. Part of the Stage 10 accounts work.
- **Invite-based multi-user (Stage 10, 2026-06-09).** `/settings/users` admin surface (admins only) creates 7-day single-use invite links. Invited users land at `/setup/accept/[token]`, create an account, and are scoped to their own data by the existing RLS policies. When Mailgun is not configured the link is shown in the UI for manual sharing.

- **Visitor-hash spoofing fix (Stage 11, 2026-07-02).** `hashVisitor` keys on the LAST X-Forwarded-For entry (the one Traefik appended from the real socket) — the first entry is client-controlled and rotating it minted unlimited visitor hashes, bypassing every visitor rate limit. `POST /api/v/:slug/view` has a 60/5min IP-keyed limit (`hashVisitorIp`) because the UA half of the visitor hash is also client-rotatable and each new hash used to fire an owner email. `INTEGRATION_API_TOKEN` export routes pin to the MCP owner account instead of exporting all users' data on multi-user instances.

When adding a new public-facing endpoint that accepts user input, default to `checkRateLimit({ scope: '<endpoint>:visitor', key: hashVisitor(req), max, windowSec })`.

## Known Issues / Quirks

- **Chrome-only by design** — `getDisplayMedia` system-audio capture is Chrome-only; the worker compositor uses `MediaStreamTrackProcessor` / `MediaStreamTrackGenerator` (Chrome 94+). Safari/Firefox aren't supported. The bubble extension is also Chrome MV3 only.
- **VPN toggles mid-recording (Tailscale et al.)** — Loomola has no VPN dependency, but toggling Tailscale on/off or switching Tailscale profiles mid-call rewrites system DNS (MagicDNS 100.100.100.100) and kills in-flight connections. Post-Stage-12/13 this cannot lose a recording (capture is local, uploads retry, orphans auto-rescue after sign-in) and live transcription reconnects with backoff (Stage 13) — a toggle costs seconds of captions, not the rest of the call. Note the prod VPS (`srv1239786`) is itself a node on Ian's tailnet, but app traffic uses the public IP/DNS path — do not "fix" anything by routing app traffic over the tailnet.
- **Extension reload protocol** — when iterating on `extension/`, after pushing the change reload the extension at `chrome://extensions` (manifest version is bumped on each set of changes specifically so this is visible — currently 0.9.0) AND close any tabs that were open during the previous extension lifetime. Old "orphan" content scripts keep running in already-open tabs and they share the page with the freshly-injected new script — `safeSendMessage` is hardened to no-op when context is dead, but tabs are cleaner with the orphan gone entirely. The extension has an options page where self-hosters set their app origin (no manifest edits required for that use case).
- **No adaptive bitrate** — R2 serves one composite file; mobile/cellular viewers eat the full bitrate. Deferred.
- **Mobile** — designed desktop-first. No focused mobile pass yet; share page renders OK below 768px but not battle-tested.
- **Brand `fontFamily` is Google Fonts only** — the share page injects `<link href="https://fonts.googleapis.com/css2?family=<name>:wght@400;500;600;700">` and applies the family page-wide. Foundry/commercial fonts (Söhne, TT Norms, Pangram Pangram "Test ..." trial fonts, etc.) silently 404 and fall back to the system sans. Custom-font upload (R2 + `@font-face`) is the right next step but not built yet.

## Speaker recognition (G-M13 v1 shipped 2026-05-04; Path C deferred)

After `generate_title_summary` completes for an **audio note** that has attendee data, a `suggest_speakers` pg-boss job auto-suggests `speaker_idx → person` mappings using `media_objects.attendees` + the new `people.is_self` flag. ✓ accepts (creates a Person inline if needed); ✗ dismisses with a sticky lock. Pill UX shaped after G-M12 folder suggestion. Pure logic in `src/lib/speaker-suggestion/` (35 unit tests).

**Attendees auto-populate from the calendar as of Stage 11 (2026-07-02):** the desktop's `CalendarAttendeeService` (EventKit) finds the event overlapping recording start, `POST /api/people/resolve` maps its attendees to People (email incl. aliases → case-insensitive name → create; `is_self` excluded), and `PATCH /api/recordings/[id]/attendees` sets them + re-enqueues suggestion. Also note: batch transcripts moved to mono+diarize the same day, so multi-party speaker indices exist for the matcher to work with (previously the stereo channel split capped speakers at 2). `sourceSeparated` in `speaker-suggestion.ts` now means `provider === "deepgram-live"` only.

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

## Stage 4 — Desktop M2 (✅ shipped 2026-05-04)

Premium recorder milestone for the macOS desktop app. Spec: [`docs/superpowers/specs/2026-05-04-desktop-app-m2-premium-recorder-design.md`](docs/superpowers/specs/2026-05-04-desktop-app-m2-premium-recorder-design.md). Detailed phase-by-phase status in [`ROADMAP.md`](ROADMAP.md).

**What's there:**
- **Composite recorder** — `CompositeRecorder` (AVAssetWriter + CIContext + CIBlendWithMask radial gradient for circle alpha) wired into `RecorderViewModel.startLocalRecording` / `stopLocalRecordingAndUpload`. Inputs: `ScreenCaptureCoordinator.onScreenSampleBuffer`, `CameraCaptureCoordinator.shared` (single-source camera shared with bubble overlay, no more two-sessions), `MicrophoneCaptureCoordinator` on AVAudioEngine + `setVoiceProcessingEnabled(true)` for AEC. Composite MP4 uploads through the existing R2 multipart pipeline as the `composite` track.
- **Recording HUD** — floating top-center pill (`VideoRecordingWindowController`): pulsing red dot + REC label + mono elapsed timer + 5-bar live audio meter + stop + discard. `panel.sharingType = .none` keeps it out of the captured frame.
- **Source picker** — `SourcePickerCard` in `MainRecorderView` with camera + mic device dropdowns, persisted to UserDefaults.
- **Permissions preflight** — `PermissionChecker` + `PermissionsView` checklist (camera / mic / screen-recording / accessibility) with status pills + Request / Open System Settings buttons. Auto-refresh on `NSWindow.didBecomeKeyNotification`.
- **Global hotkeys** — Carbon `RegisterEventHotKey` wrapper (`GlobalHotkey`). ⌥⇧B toggles bubble overlay. ⌥⇧R toggles recording (start if idle, stop+upload if recording). Bridge from AppDelegate to view model is `RecorderCommands.toggleRecording` NotificationCenter broadcast — view model subscribes via `.onReceive` and routes based on `activeRecordingKind`. Matching menubar items: `Start Recording` and `Show/Hide Bubble Overlay`.
- **Bubble overlay** — fullscreen-overlay architecture (one stationary panel that NEVER moves, bubble is a moving subview, 60Hz `NSEvent.mouseLocation` polling toggles `ignoresMouseEvents` based on hover position over the circular hit region). Eliminates macOS native tiling + Chrome split-view snap zones during drag. Scroll-wheel resize (90–360 pt, ⌥/⇧ for slow/fine). `sharingType = .none` so SCK excludes it from capture (compositor draws bubble independently from `CameraCaptureCoordinator.shared.latestPixelBuffer()`).
- **Singletons for cross-subsystem state:** `CameraCaptureCoordinator.shared`, `BubblePositionController.shared` — single source of truth for camera frames + bubble placement, accessible from both AppDelegate (overlay) and RecorderViewModel (compositor).
- **Sample-buffer plumbing convention:** capture coordinators have `nonisolated(unsafe)` `onXxxSampleBuffer` callback properties so the compositor can subscribe without touching the existing file-writer paths.

**Pending:** user-driven E2E smoke (record → stop → upload → playback on share page) on the next dogfood session.

## Stage 5 — Desktop M3 (✅ shipped 2026-05-04, visual restructure)

Granola-grade shell milestone. M2 made the recorder feel premium; M3 made the surrounding shell feel premium. Spec: [`docs/superpowers/specs/2026-05-04-desktop-app-m3-visual-restructure-design.md`](docs/superpowers/specs/2026-05-04-desktop-app-m3-visual-restructure-design.md). Plan: [`docs/superpowers/plans/2026-05-04-desktop-app-m3-visual-restructure.md`](docs/superpowers/plans/2026-05-04-desktop-app-m3-visual-restructure.md).

**Design system (`UI/DesignSystem/`):**
- **Tokens** (`Tokens/`): `DSColor` (light/dark RGB pairs for bg, text, border, accent, state), `DSSpacing` (4pt rhythm, xs..xxxl), `DSRadius` (sm/md/lg/xl/pill), `DSShadow` (subtle/raised/brand), `DSFont` (Display.xl/lg, Body.lg/md/sm, Mono.timer/body — Inter + JetBrains Mono with system fallback), `LoomolaMotion` (quick/medium/expressive curves, reduce-motion-aware at callsite).
- **Bundled fonts:** Inter (variable, OFL) + JetBrains Mono (variable, OFL) under `Sources/LoomDesktopApp/Resources/Fonts/`. Registered at `LoomDesktopApp.init()` via `CTFontManagerRegisterFontsForURL`. `FontLoader.swift`.
- **Controls** (`Controls/`): `PrimaryButton`, `SecondaryButton`, `IconButton`, `SegmentedControl` (sliding-thumb via `matchedGeometryEffect`), `Field` (branded text input with focused-accent border), `FieldPicker` (Menu + custom label, no system PopUpButton chrome), `Pill`, `StatusDot`. Replace every `.borderedProminent` / default Picker / system text input in the shell.

**Shell + per-state home views:**
- **Custom title bar** (`Shell/CustomTitleBar.swift`) — 40pt strip with traffic-light spacer + Loomola wordmark + settings gear `IconButton` + account avatar `IconButton`. System "Loomola Desktop" title hidden via `.windowStyle(.hiddenTitleBar)`.
- **Settings sheet** (`Shell/SettingsSheet.swift`) — sheet from the gear, sections: Sources / Permissions (only when missing or denied) / Integrations / Account / Diagnostics (collapsed). Receives view model via `.environmentObject`.
- **Account popover** (`Shell/AccountMenuPopover.swift`) — anchored to the avatar; email + Open dashboard + Open library + Sign out.
- **`Home/IdleHomeView`** — 95% case. "Capture" headline + hero card (`HeroCaptureSection` with `SegmentedControl` for Video/Audio note + start/stop CTAs + inline mic/cam `FieldPicker`s) + optional meeting prompt card + Recent strip.
- **`Home/RecordingHomeView`** — replaces idle while recording. Pulsing red dot, big headline, mono timer (handles hour-rollover), 8-bar accent meter, Stop & upload + Discard (+ Open note for audio).
- **`Home/PermissionsHomeView`** — hero state when any required permission missing/denied. Per-row Pill + Request / Open Settings buttons. Auto-completes on grant via `NSWindow.didBecomeKeyNotification`.
- **`Home/SignedOutHomeView`** — centered brand moment. Loomola glyph 64pt + "Capture you own." headline + Field inputs + full-width Sign in button.
- **`Recent/RecentStrip`, `Recent/RecentCard`, `Recent/RecentRecordingsService`** — new strip showing last 4 recordings/notes. Backed by new `GET /api/recordings/recent` endpoint that returns slim DTOs with inlined presigned thumbnail URL (no N+1). Auto-refreshes on app activation, after upload completes, every 60s. Click → opens `/v/<slug>` or `/notes/<slug>` in default browser. Empty state: "Nothing recorded yet. Hit Start recording or press ⌥⇧R to begin."

**Router:** `MainRecorderView.contentForCurrentState` routes by `(state, activeRecordingKind, permissions)` to one of four home views. File dropped from 947 → 205 lines (78% cut). Old `AppHeader / SignedOutView / CaptureCard / SourcePickerCard / IntegrationsCard / CaptureSourcesView / StatusCard / FooterBar / DeveloperToolsDisclosure / private Card / private CaptureMode / private FocusedField` all deleted. Old `PermissionsView.swift` (banner-style) deleted in favor of `PermissionsHomeView`.

**Visual regression catch-all:** zero non-DesignSystem usages of `borderedProminent`, `windowBackgroundColor`, `controlBackgroundColor`, `Font.system`, or `Font.custom` in `UI/`. Verified via grep.

**Pending:** user E2E (cold-launch sign-in, idle home with Recent, start/stop video, start/stop audio, settings sheet round-trip, account menu sign-out).

## Stage 6 — Live notes (Granola-shape side panel + pause/resume)

For audio note recordings only (video flow unchanged). Six phases:

- **Phase A — `PauseAdjuster`** (pure-logic struct, 7 unit tests) tracks pause/resume PTS arithmetic so paused gaps are removed from the output stream. Wired into `MicrophoneCaptureCoordinator` via `pause()` / `resume()` / `isPaused`. Sample tap reads adjusted PTS under an NSLock; sample-buffer construction stays off the hot path.
- **Phase B — `SystemAudioCaptureCoordinator`** gets the same treatment (uses `CMSampleBufferCreateCopyWithNewTiming` since SCStream sample buffers are immutable). `AudioNoteRecorder.pause()/.resume()` pause both the mic + system audio in lockstep. `RecorderViewModel.pauseAudioNoteRecording()` / `resumeAudioNoteRecording()` + `@Published isAudioNotePaused`. `RecordingHomeView` shows Pause↔Resume toggle (replaces Discard); pulsing red dot becomes static warning-orange when paused; headline reads "Paused"; timer freezes. Discard moves into a `⋯` menu.
- **Phase C — `NotesSidePanelWindowController`** floating ~380×full-visible-height NSPanel anchored to the right edge, mimicking Granola's footprint. Header + title field bound to `viewModel.audioTitle` + big `TextEditor` bound to new `@Published liveNotesBody` + bottom controls bar (state indicator, timer, Pause/Resume, Stop & upload, ⋯ menu). `level = .floating + .canJoinAllSpaces + .stationary` so it follows the user across spaces (Meet/Zoom often goes fullscreen). Auto-summons on audio note start, dismisses on stop. The small floating capsule (`AudioRecordingWindowController`) is suppressed for audio notes — having both is redundant.
- **Phase D — debounced autosave to existing `PUT /api/notes/<mediaId>`.** Adds `BackendClient.putNoteBody(mediaId:body:)` and a `notesAutosaveTask` in the view model that watches `liveNotesBody` for ~2s of idle then PUTs. Final synchronous flush on Stop & upload before the upload kicks off so the AI pipeline sees the user's full content. Avoids re-PUTting unchanged content via `lastSyncedNotesBody`.
- **Phase E — pause-aware regen trigger:** **no work needed.** `generate-title-summary.ts:128` already reads `notes.body` and feeds it as `rawNotes` to the LLM prompt alongside the Deepgram transcript. The existing pipeline picks up the user's typed notes automatically.
- **Phase F — tests + smoke:** 7 PauseAdjuster unit tests cover the PTS math. Full E2E (start audio → type live → pause → type more → resume → stop → verify duration = active time, notes persisted, AI regen used both transcript + notes) pending Ian's next dogfood session.

**Where the cloud-first architecture line sits:** Web stays the editor (rich formatting, AI Q&A, brand profiles, share links, going back to past notes). Desktop is capture + a focused live notepad. Notes typed live and notes edited on web both write to the same `notes.body` field — single source of truth. Don't try to rebuild the full notes editor on desktop.

## Recent web work (post-G-M13)

- **G-M14 — Notes bulk select / delete / move:** notes list converted to a client component, mirrors `RecordingsGrid` UX (per-row checkbox on hover, shift-click range, bottom action bar). Reuses the existing type-agnostic `/api/recordings/bulk-delete` and `/api/recordings/[id]/folder` endpoints.
- **G-M15 — Notes-list attachment thumbnails + back-to-tab:** notes with attached images render the images in the row icon (1 = full, 2 = halves, 3-4 = 2×2 grid). Note-detail back arrow returns to `/?tab=notes`. New `listImageAttachmentsForMediaIds` query is a single round trip per dashboard load.
- **G-M16 — Desktop AEC for mic:** mic capture rewritten on AVAudioEngine + voice processing. macOS subtracts the system playback signal from mic input — no more participant-voice doubling when recording over speakers. *Stage 7 update (2026-05-06):* VPIO is now disabled by default because it ducks system audio output for the recording's duration (Zoom/Meet/music goes silent). Mic + system audio are still captured as separate tracks; server-side mix-audio job can dedup if echo ever shows up. Headphone users (the typical recording-a-call setup) have no acoustic feedback path so no echo to begin with.
- **G-M17 — AI notes scaling for hour+ to multi-hour meetings:** `enhancedNotesSchema.summary` cap raised 6000 → 200000 chars; `maxOutputTokens: 32000` on the audio enhance call. 5-6 hour event recordings render full structured notes instead of truncating mid-sentence. Note page title trimmed so body sits above the fold.
- **Share-link previews — Slack/Discord unfurls:** `/v/:slug` now generates per-recording Open Graph/Twitter metadata from the existing title/summary and points `og:image` at `GET /api/v/:slug/thumbnail.jpg`. The thumbnail route proxies the stored composite thumbnail only for public, ready video recordings; locked/not-ready/missing cases return the generic Loomola image. Chat apps cache exact URLs aggressively, so add a query string when retesting a previously pasted link.

## Stage 6 — Live notes (✅ shipped 2026-05-05)

Granola-shape side panel + pause/resume for audio note recordings. Six phases (A-F):
- `PauseAdjuster` (pure logic, 7 unit tests) tracks pause/resume PTS arithmetic so paused gaps are removed from the output.
- `MicrophoneCaptureCoordinator` + `SystemAudioCaptureCoordinator` pause in lockstep via `AudioNoteRecorder.pause()/.resume()`.
- `NotesSidePanelWindowController` floating ~380×full-visible-height NSPanel anchored to the right, follows across spaces (`canJoinAllSpaces + stationary`), auto-summons on audio note start.
- `liveNotesBody` debounced autosave to `PUT /api/notes/<mediaId>` (~2s idle window). Final synchronous flush on Stop & upload before the upload fires so the AI pipeline sees the user's full content.
- Pause-aware regen: `generate-title-summary.ts` already reads `notes.body`, no further work needed.

**Web stays the editor; desktop is capture + focused live notepad. Notes typed live and notes edited on web both write the same `notes.body` field — single source of truth.**

## Stage 7 — Desktop stability sprint + Granola UX + multi-folder Phase 1 (✅ shipped 2026-05-06)

A high-density bug-fix + polish day after the M3 dogfood surfaced multiple sharp edges. See ROADMAP.md for the full table; key items:

- **Audio note crash fixed.** `AudioAssetWriter` rewritten from `AVAssetWriter + AVAssetWriterInput` (which throws an uncatchable NSException from inside AVFCore on macOS 26.4.1) to `AVAudioFile` (different orchestration layer via ExtAudioFile, same AAC m4a output). Mic flow now passes the engine tap's PCM buffer directly to the writer.
- **VPIO disabled by default** (see G-M16 update above) so Zoom/Meet/music doesn't go silent during recording.
- **`URL.appending(path:)` percent-encoding fix.** The Recent strip silently never populated because `?` got encoded to `%3F`. Switched to `URL(string:relativeTo:)` and lifted to `BackendURLBuilder` with regression tests.
- **Auth tokens flipped to file storage by default** (see Security posture update).
- **Logger-based observability.** Switched the desktop's print statements to `Logger(subsystem: "cloud.dissonance.loom.desktop", category: ...)` at `.notice` level. Categories: `boot`, `recorder`, `recent`, `backend`. Visible in `log show --predicate 'subsystem == "cloud.dissonance.loom.desktop"'`.
- **`durationSeconds` JSON shape coercion.** Drizzle `numeric` columns arrive as JS strings; the `/api/recordings/recent` route now coerces to Number before serializing so Swift's strict JSONDecoder accepts it.
- **`restoreSession` 10s timeout.** Supabase's `setSession` can hang forever on macOS 26.4.1; wrapped in a continuation-based race so the user is never pinned on a frozen sign-in screen.
- **Recent populate-on-launch race fixed.** `apply(session:)` now explicitly calls `_recentService?.refresh()` after setting accessToken — covers the `.preparingPermissions → .signedInIdle` transition that was creating the service before the token landed.
- **Granola-style Recent rows.** Folder pill (right side, hidden when unfiled + not hovering) → folder picker popover with checkmark on current. Time-of-day in mono-digit right column (replaces relative timestamps; date already established by section header). Hover bg highlight. Date grouping (Today / Yesterday / Mon, May 4 / Apr 28).
- **Recent video cards bumped to 320×180** (true triple from the original 140×84). 1px border + `.dsShadow(.subtle)` at rest, `.raised` on hover. 3 cards per row.
- **Multi-folder Phase 1.** New `media_folder_assignments` join table + dual-write semantics in `moveRecordingToFolder` and `acceptPendingSuggestion`. New endpoints: `GET/POST /api/recordings/{id}/folders`, `DELETE /api/recordings/{id}/folders/{folderId}`. Reads still go through legacy `media_objects.folder_id`. Phase 2 (read flip) and Phase 3 (drop column) deferred — Phase 2 needs UI work + desktop verification. Spec: [`docs/superpowers/specs/2026-05-06-multi-folder-assignments-design.md`](docs/superpowers/specs/2026-05-06-multi-folder-assignments-design.md).

## Stage 8 — Granola-grade desktop audio note workspace (✅ shipped 2026-05-06)

A second high-density polish day after Stage 7's dogfood. The audio note flow goes from "functional capture" to "premium note workspace." See ROADMAP.md for the table; key moves:

- **Granola-shape workspace.** `NoteWorkspaceView` now hosts the entire audio note experience: big serif title, three meta pills (Today / Me / Add to folder), live-tokenized markdown body via `MarkdownTextEditor` (NSTextView wrapper with regex-based attribute application), drag-and-drop image attachments, click-thumbnail fullscreen preview, right-click → Remove, attachments strip pinned to the bottom, hover-revealed ⋯ menu at top-right (Copy text / Open on web / Discard / Move to trash).
- **Markdown syntax hidden in renderer.** The `# `, `**…**`, `*…*`, `` `…` `` source markers render at 0.01pt + `NSColor.clear` so they collapse visually; styled content (heading-size, bold, italic, mono) renders normally. Underlying string remains valid markdown — saves to `/api/notes/<id>` are unchanged, undo/redo works.
- **One-window architecture.** Workspace lives in the main window via `MainRecorderView.noteTarget: NoteWorkspaceTarget?`. Set on audio-recording start (auto), set on Recent audio-row click, cleared by the home/back button. The right-anchored NSPanel approach was deleted (`NotesSidePanelWindowController.swift` removed) because `canJoinAllSpaces + stationary` painted it on every Space simultaneously and Mission Control couldn't drag it between desktops. Main window can now be shrunk to a Zoom-friendly width that the OS remembers, and dragged between desktops normally.
- **Toolbar items in the unified system NSToolbar.** Home/back (workspace) and sidebar/wordmark/settings/avatar (home) are first-class `ToolbarItem`s declared via SwiftUI's `.toolbar { ToolbarItem(...) }` API. `WindowChrome.applyTallTitleBar` sets `window.toolbarStyle = .unified` + an empty `NSToolbar` so the title bar grows to ~52pt; macOS recenters the traffic lights with breathing room. `.toolbarBackground(.hidden, for: .windowToolbar)` keeps the title bar visually continuous with the canvas. SwiftUI swaps active items as the view tree changes. `CustomTitleBar.swift` is no longer rendered. **Workspace ⋯ menu is NOT a toolbar item** — placing it as `.primaryAction` visually grouped it with the home button on the left. It now lives as a hover-revealed `.overlay(alignment: .topTrailing)` on the workspace body, driven by `.onContinuousHover` on the body (same Granola pattern that was there pre-toolbar refactor).
- **Generate notes pill (review mode).** Bottom-anchored green ✦ pill in the workspace's review mode. POSTs `/api/notes/<id>/enhance` (existing pg-boss `generate_title_summary` re-run), polls `GET …/enhance` every 3s up to 60s; on `complete` updates the title + body bindings in place. Auto-flushes pending autosave first so the AI run sees the user's latest typed notes.
- **RecordingStatusPill on home view.** When `activeRecordingKind == .audio && noteTarget == nil` (user closed the workspace mid-recording), a persistent bottom-anchored pill renders: pulsing red dot · "Recording" · timer · meter · Open note · Stop. Eliminates the "did I forget I'm recording?" footgun.
- **Recent video cards rebalanced.** 320×180 → 264×148 (still 16:9), gap `xl → lg`. Math: 3 × 264 + 2 × 16 + 64pt padding = 824pt — fits the default 1080pt window AND the 920pt min. Audio note tab unchanged. Reverses Stage-7's 320pt bump that was tuned for 1080pt-only.
- **Sized window default.** `defaultSize(width: 1080, height: 740)` + `minWidth: 920, minHeight: 620`. Half a 1080p / third of a 1440p screen — small enough to live next to a Zoom call.
- **Workspace content readable cap.** `maxWidth: 640` centered horizontally so the editor doesn't sprawl across a wide window; recording control bar capped at 480pt.
- **Single audio recording UI.** The small floating capsule and `RecordingHomeView` are suppressed for audio mode — workspace owns the recording UI.
- **Floating cross-Spaces recording pill.** Granola-shape vertical capsule (`RecordingStatusOverlayController` + `RecordingStatusOverlayView`, file `desktop/Sources/LoomDesktopApp/UI/RecordingStatusOverlay.swift`) shown for the duration of every audio note recording. Floats on every Space and every app (`canJoinAllSpaces + .stationary + .fullScreenAuxiliary`); Loomola brand mark + 3-bar live meter; hover reveals a 6-dot drag grip (drag-to-move with screen clamping + UserDefaults position recall under `loomola.recordingPill.position`); tap calls `AppActivation.bringRecorderToFront()` + sets `noteTarget = .recording`. `sharingType: .none` keeps it out of the user's own captures. The Stage-8 in-app `RecordingStatusPill` and the no-op `AudioRecordingWindowController` were retired in the same change.

## Stage 9 — Reliability sprint (✅ shipped 2026-05-06)

A near-miss on a 72-min audio recording (Coolify HTML brownout mid-multipart upload + dead pg-boss workers + no orphan-recovery UX in the desktop) drove three coupled fixes:

- **`src/instrumentation.ts`** — Next.js App Router boot hook calls `getBoss()` on container start so workers begin polling immediately. Without this, after a Coolify restart pg-boss is dead until something fires an `enqueueX` call. Recordings used to silently sit in `transcribing` for hours. **Stage 9 attempt 1 caused a full prod outage (reverted); Stage 10 attempt 2 fixed the root cause (dynamic import inside `if (NEXT_RUNTIME === 'nodejs')` + `serverExternalPackages` for pg/pg-boss — see `src/instrumentation.ts` for the full history comment).**
- **Desktop `BackendClient.detectServiceUnavailable`** — recognises Traefik/Coolify HTML brownout pages (`Content-Type: text/html` or body starting with `<!doctype`/`<html>`) and throws a typed `BackendClientError.serviceUnavailable(path:statusCode:)` with `isTransient: true` instead of a misleading "couldn't read backend JSON" decode error. Threaded through every request path: `getData`, `jsonRequest`, `uploadNoteAttachment`, `deleteNoteAttachment`, `enhanceNote`.
- **Desktop orphan recovery** — `OrphanedRecordingStore.shared` (singleton ObservableObject) persists failed audio uploads into `~/Library/Application Support/LoomDesktop/orphaned-recordings/<timestamp>-<slug>/{mic.m4a, system-audio.m4a, metadata.json}`. `RecorderViewModel.stopAudioNoteRecordingAndUpload`'s catch handler captures into the store before surfacing the error, then calls `audioNoteRecorder.detachSessionAfterOrphanSave()`. `OrphanRetryCoordinator` re-runs `start → multipart → complete` from the durable copies (best-effort aborts the original stuck row). New Settings → Recovery section lists orphans with **Retry upload** / **Reveal in Finder** / **Discard**, hidden when the store is empty. Rescued orphans show a "Rescued" pill + Open button → `/notes/<slug>`.
- **Helper scripts kept around for incident response**: `scripts/diag-latest-audio.mjs`, `scripts/rescue-orphan-audio-note.mjs`, `scripts/wake-prod-boss.mjs`. The first reports the latest audio note's full state (DB row + transcript + AI outputs + pg-boss jobs); the second mixes raw mic + system tracks locally with ffmpeg, uploads to R2, inserts a `media_objects` row, enqueues `transcribe`; the third hits an authed enhance endpoint with a bearer token to wake pg-boss when it's silently dead.

Tests: 4 new `OrphanedRecordingStoreTests` cover capture / round-trip / mark-rescued / discard. All 96 desktop tests + 247 server unit tests pass.

## Open design queue (specs filed, not yet built)

Most-recently-spec'd milestones — see ROADMAP.md → "Open follow-ups" for the full list. These are the candidates a fresh agent is most likely to be asked to plan / implement next:

- **Live transcription drawer (desktop).** Granola's killer in-meeting moment — transcript drawer slides up from the bottom of the workspace, fills with rounded paragraph cards as people speak, two-tone rendering for confirmed vs in-progress text. Deepgram streaming WebSocket, short-lived auth keys minted by `/api/transcribe/live-token`, drawer hosted inside `NoteWorkspaceView` (the chevron-up next to the audio meter is already a reserved placeholder). ~3.5 days for v1. Spec: [`docs/superpowers/specs/2026-05-06-live-transcription-drawer-design.md`](docs/superpowers/specs/2026-05-06-live-transcription-drawer-design.md).
- **Hybrid transcription fast/slow modes (exploratory).** Add `local-whisper` as a third value to the existing `TRANSCRIBE_PROVIDER` axis. Fast = today's Deepgram path; Slow = WhisperKit on Apple Silicon during user-idle windows (macOS forbids CPU during literal sleep). Server stays unchanged — desktop POSTs to a new `POST /api/recordings/<id>/transcript/local`. ~3 days for v1. **Status: exploratory, Ian flagged "not sure I want it."** Spec: [`docs/superpowers/specs/2026-05-06-hybrid-transcription-fast-slow-design.md`](docs/superpowers/specs/2026-05-06-hybrid-transcription-fast-slow-design.md).
- **Multi-folder Phase 2 (read flip).** Cut Loomola over to `media_folder_assignments` everywhere — list views, search, recent route, desktop picker, dashboard pills. Phase 1 (schema + dual-write) shipped Stage 7. ~6 hours focused. Spec: [`docs/superpowers/specs/2026-05-06-multi-folder-assignments-design.md`](docs/superpowers/specs/2026-05-06-multi-folder-assignments-design.md).

## Granola-alt (in progress)

A second product (audio meeting notes) built on top of this same backend. Spec: [`docs/superpowers/specs/2026-04-28-granola-clone-design.md`](docs/superpowers/specs/2026-04-28-granola-clone-design.md).

- **G-M1 shipped:** six new Postgres tables (`notes`, `people`, `speaker_assignments`, `dictionary_terms`, `transcript_chunks`, `summary_embeddings`), four extended tables (`media_objects`, `transcripts`, `ai_outputs`, `brand_profiles`), pgvector extension, HNSW vector indexes, RLS policies, Supabase Realtime publication on `ai_outputs`, and thin CRUD API routes for the new entities.
- **Schema additions you'll see:** `media_objects.attendees` (jsonb of person UUIDs), `media_objects.r2MixedKey` (mic+system mixed mono audio), `media_objects.meetingDetectedApp`, `media_objects.sourceContextHint`, `media_objects.obsidianSyncedAt`, `transcripts.provider` (default `deepgram`), `ai_outputs.generationStatusValue` (`pending|streaming|complete|failed`), `brand_profiles.meetingNotesVaultPath`.
- **No UI yet** — that lands in G-M4 (`/notes/:id`) and G-M5 (tabbed dashboard).
- **Feature flag:** every Granola API route checks `ENABLE_GRANOLA === 'true'`. When false / unset, the routes return 404 and Loom-only deploys stay dark.
- **Provider abstraction:** env vars `LLM_PROVIDER`, `LLM_MODEL`, `EMBEDDING_PROVIDER`, `TRANSCRIBE_PROVIDER` allow swapping providers without code changes.
- **`INTEGRATION_API_TOKEN`:** bearer token for upcoming LLM-accessible export endpoints (lands in G-M11). Do NOT expose this in client code; server-only.

## Out-of-Stage-1 Scope (deferred, separate spec when picked up)

- ~~**macOS desktop app**~~ — ✅ shipped Stage 4 (premium recorder) + Stage 5 (visual restructure) + Stage 7 (stability + Granola UX).
- ~~**Granola-alt (audio capture)**~~ — ✅ Stage 2 shipped G-M1 through G-M17 (everything except speaker recognition v2).
- **iOS / Android apps** — ReplayKit on iOS, similar capture flow. Single-user-account v1.
- **Native Windows app** — direct gap to Loom (which has Windows). Lower priority than iOS for this user base.
- **Multi-tenant / team invites** — single-user product today; team accounts is a major schema + auth surface.
- **Custom domains per brand** — `videos.acme.com` CNAME → VPS, served as the brand's share-page surface. Pairs with Brand Layer 2.
- **AI Q&A chat** on a single recording / note (transcript + summary embeddings exist; surface UI is the missing piece).
- **AI Q&A across the entire library** (semantic search + chat).
- **Note templates** — Granola's 30+ template library that shapes the AI title/summary prompt.
- **Folder customization** — color + emoji icon per folder (Granola pattern).
- **Emoji reactions** on share pages.
- **Outbound webhooks** for automations.
- **Multi-folder Phase 2 + 3** — read flip then drop legacy `folder_id` column. Phase 1 (schema + dual-write) shipped 2026-05-06; spec: [`docs/superpowers/specs/2026-05-06-multi-folder-assignments-design.md`](docs/superpowers/specs/2026-05-06-multi-folder-assignments-design.md).

## Working with Claude Code on this repo

- This file is for *your* context. The companion file `AGENTS.md` mirrors it for Codex/non-Claude-Code agents.
- Use the `superpowers:*` skill family for big features (brainstorm → write spec → write plan → execute via subagents). For small fixes, just go.
- Prefer editing existing files over creating new ones. Don't write speculative documentation.
- The user's CLAUDE.md priority instruction: *no premature abstraction; three similar lines is better than a helper.* Don't add JSDoc unless WHY is non-obvious. Don't add error handling for impossible cases.
