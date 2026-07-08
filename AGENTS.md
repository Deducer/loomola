> # 🚦 Setting up your OWN copy of Loomola? Do NOT follow this file — go to the [README](README.md).
>
> **This file is the maintainer's operational brief for the live production instance.** It assumes you are contributing to the codebase or operating `loom.dissonance.cloud`. If you are a **self-hoster** standing up your own copy — or an **AI assistant helping one** — then everything below about **Doppler, Coolify, pushing to `main`, the specific Supabase project id, the maintainer's domain/email, and `npm run smoke` / `npm run mcp-smoke`** does **NOT** apply to you. It will actively mislead a fresh setup.
>
> **What to do instead:** follow **[README.md → "Self-host Quickstart"](README.md#self-host-quickstart)**. Create your own fresh accounts and keys. Do **not** push to this repo's `main`, do **not** deploy to or reference the maintainer's infrastructure, and do **not** copy the maintainer's `.env.local`. For a brand-new instance, "Quickstart A — Docker Compose" with a free Supabase project is the path.
>
> Everything from the heading below is maintainer-only context.

---

# Loom Clone — Project Notes for Codex / non-Claude-Code agents

**Owner:** Ian Cross  **Purpose:** Self-hosted screen recording platform replacing Loom's $20/mo subscription. Designed as a polymorphic media platform so future audio-based products (Granola-alt, MacWhisper-alt) share the backend.

**Live:** https://loom.dissonance.cloud

## Multi-product strategy

This repo hosts **two products on one codebase**, gated by a single env flag:

- **Loom** — always built. The screen-recording product covered by this AGENTS.md.
- **Granola** — built into the same `main` branch behind `ENABLE_GRANOLA=true`. When the flag is `false` (default), Notes routes return 404, the Notes dashboard tab is hidden, and audio-only `media_objects` rows are inert. When `true`, both products run on the same Postgres / R2 / Mailgun / Auth.

**Why one repo, one branch?** Schema is already polymorphic (`media_objects.type = 'video' | 'audio'`); the pipeline (Deepgram → Claude → pg-boss) doesn't care about media type; folders / search / brand profiles / comments / sharing / view tracking are polymorphic-by-construction. A long-lived branch would diverge on migrations; a fork forces every Loom fix to be cherry-picked forever.

**For shipping pure Loom**: deploy from the `loom-v1.0` git tag (or any later commit) with `ENABLE_GRANOLA=false`. No Granola UI or routes are reachable.

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
| GitHub repo | https://github.com/Deducer/loomola | Public (open-sourced); push to `main` → Coolify rebuilds + deploys. No secrets or personal/business-contact names in committed files. |
| Coolify | (manual UI on the VPS) | Container env contains only `DOPPLER_TOKEN`; everything else is injected at boot |
| Doppler project / config | `dissonance-cloud` → `prd_loom` | Non-inheriting branch config scoped to this app only |
| Supabase project | `eghwhnxuvbguoayzdlof` (`loom-clone`) | Org: Dissonance Inc. (`fpbgreogfejqrurxqnvq`), region `us-east-1` |
| Supabase dashboard | https://supabase.com/dashboard/project/eghwhnxuvbguoayzdlof | |
| Cloudflare R2 | bucket configured via `R2_BUCKET` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_ACCOUNT_ID` / `R2_ENDPOINT` | All five are in Doppler |
| Deepgram | `DEEPGRAM_API_KEY` (Doppler) | Async prerecorded API + HMAC-signed webhook back to `/api/webhooks/deepgram/[recordingId]/[sig]` |
| Anthropic (Claude) | `ANTHROPIC_API_KEY` (Doppler) | Sonnet 4.6 via Vercel AI SDK; provider-agnostic (swappable) |
| Mailgun | `MAILGUN_API_KEY`, `MAILGUN_DOMAIN=mg.dissonance.cloud`, `MAIL_FROM_ADDRESS` (Doppler) | Used for new-comment + first-view-per-visitor notifications to recording owner |
| Feature flag: `ENABLE_GRANOLA` | Doppler (`prd_loom`) | `'true'` enables the Granola product (audio meeting notes) on top of Loom. `'false'` / unset = Loom-only. Read by every server-side gate; client UI hides Notes-tab when false. Set per-deploy. |
| MCP server | `http://localhost:3000/api/mcp` | Streamable HTTP MCP endpoint for local agents. Bearer token is `MCP_TOKEN` in Doppler; loopback-only unless `MCP_ALLOW_PUBLIC=true`. Phase 1 is read-only: search, recent recordings, recent meetings, get media, action items. |

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

> **Note:** This file has drifted from the canonical project notes — `CLAUDE.md` is the up-to-date source for stage history, current architecture, and conventions. Read it first; this file's deeper sections are kept for compatibility but may lag.

Stage 1 (M1–M11) + Stages 1.5–1.10 + 1.99 + Stage 2 (Granola-alt G-M1–M17) + Stage 3 (security) + Stage 4 (desktop M2 premium recorder) + Stage 5 (desktop M3 visual restructure) + Stage 6 (live notes) + Stage 7 (stability + Granola Recent UX + multi-folder Phase 1) + Stage 8 (Granola-grade desktop note workspace) + Stage 9 (reliability sprint: orphan recovery + boot-warmed pg-boss + brownout detection) + Stage 10 (open-source readiness, v1.0.0) + Stage 11 (cost + trust sprint: mono+diarize transcription, real trash + daily purge reaper, processing-status liveness, XFF rate-limit fix) + Stage 12 (desktop auth reliability: single-refresh-authority auth with no SupabaseClient, mid-recording token keep-alive, auto-retry Recovery after sign-in, upload-path transient retries) + Stage 13 (trust sprint II: video orphan recovery, failure-alert emails, live-transcription reconnect, echo-dedup mix, merged video AI call, recent-list pagination) all shipped. See `CLAUDE.md` for per-stage details. Big-picture surface area:

- `/` — dashboard with folder sidebar, search, sort/filter, drag-and-drop card-to-folder, hover card menu (Edit / Move / Delete). Cards click into the **edit** page (creator-first), not the share page.
- `/record` — recording flow: pre-record form → preparing (permissions) → 3-2-1 countdown → recording → uploading → finished. Bubble can be dragged anywhere on screen during recording (Chrome `documentPictureInPicture` window with the live camera).
- `/v/:slug` — visitor share page. Watch-first: title → player (Loom-style chapter segments + hover-scrub thumbnails) → AI summary → action items → chapters list → tabs (Transcript · Comments). Brand-themed when a brand profile is assigned (logo + accent + tagline + custom Google Font + CTA pill + footer text). Public links emit Open Graph/Twitter metadata and a stable `/api/v/:slug/thumbnail.jpg` route for Slack/Discord unfurls; password-protected, not-ready, missing, or thumbnail-less recordings fall back to a generic Loomola image.
- `/recordings/[id]/edit` — creator console. Sticky preview on the left, settings + trim + downloads + analytics + danger-zone on the right (capped at 360px so the video gets the lion's share of the page).
- `/brands` — brand profile CRUD with full Layer 2 theming fields.
- `desktop/` — native macOS companion app, **production-grade** through Stage 8. Composite recorder (AVAssetWriter + CIContext), audio note flow on AVAudioFile (post-Stage-7 rewrite for macOS 26.4.1 AVFCore bug), Granola-grade one-window note workspace (markdown editor with hidden syntax, drag-drop image attachments, Generate-notes pill, RecordingStatusPill on home view). Toolbar items live in the unified system NSToolbar via SwiftUI's `.toolbar { ToolbarItem(...) }` API. Auth tokens in file storage by default. Logger-based observability (`subsystem: cloud.dissonance.loom.desktop`). Builds via `desktop/scripts/install-local-app.sh`. See `CLAUDE.md` for stage-by-stage detail.

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
- **Deepgram callback nonce.** Single-use nonces persisted in `webhook_nonces`, atomically consumed via `UPDATE ... WHERE consumed_at IS NULL AND expires_at > now()`. Webhook URL shape: `/api/webhooks/deepgram/[recordingId]/[nonce]/[sig]`.
- **Persistent rate limits.** `src/lib/rate-limit/check.ts` (sliding-window over `rate_limit_events`) shared by comment posts (3/5min/visitor) and password unlock attempts (5/5min/visitor). Pure decision lives in `src/lib/rate-limit/evaluate.ts`.
- **Desktop Keychain-only.** `desktop/Sources/LoomDesktopApp/Auth/AuthSessionStore.swift` no longer falls back to plaintext-file storage based on bundle path. `.fileForTesting` mode survives only as a unit-test seam.

- **Visitor-hash spoofing fix (Stage 11, 2026-07-02).** `hashVisitor` keys on the LAST X-Forwarded-For entry (the one Traefik appended from the real socket) — the first entry is client-controlled and rotating it minted unlimited visitor hashes, bypassing every visitor rate limit. `POST /api/v/:slug/view` has a 60/5min IP-keyed limit (`hashVisitorIp`) because the UA half of the visitor hash is also client-rotatable and each new hash used to fire an owner email. `INTEGRATION_API_TOKEN` export routes pin to the MCP owner account instead of exporting all users' data on multi-user instances.

When adding a new public-facing endpoint that accepts user input, default to `checkRateLimit({ scope: '<endpoint>:visitor', key: hashVisitor(req), max, windowSec })`.

## Known Issues / Quirks

- **Chrome-only by design** — `getDisplayMedia` system-audio capture is Chrome-only; Document PiP is Chrome-only. Safari/Firefox would partially work (no system audio, no floating bubble).
- **Recording the entire screen + bubble pip** — the bubble pip window is itself visible in a full-screen capture (along with Chrome's small window-chrome titlebar on the pip). For tab/window recordings it's invisible to the capture. The cleanest fix would be a Chrome extension that injects a true frameless circle bubble as a content-script DOM element in the captured tab — that's how Loom does it for the web.
- **No adaptive bitrate** — R2 serves one composite file; mobile/cellular viewers eat the full bitrate. Deferred.
- **Mobile** — designed desktop-first. No focused mobile pass yet; share page renders OK below 768px but not battle-tested.
- **Brand `fontFamily` is Google Fonts only** — the share page injects `<link href="https://fonts.googleapis.com/css2?family=<name>:wght@400;500;600;700">` and applies the family page-wide. Foundry/commercial fonts (Söhne, TT Norms, Pangram Pangram "Test ..." trial fonts, etc.) silently 404 and fall back to the system sans. Custom-font upload (R2 + `@font-face`) is the right next step but not built yet.

## Speaker recognition (G-M13 v1 shipped 2026-05-04; Path C deferred)

`suggest_speakers` pg-boss job auto-suggests `speaker_idx → person` for audio notes using `media_objects.attendees` + `people.is_self`. ✓/✗ pill on the transcript card on `/notes/:id`. Pure logic in `src/lib/speaker-suggestion/`. Worker is audio-only for v1 because the labeling UI is audio-only.

**v2 (Path C, deferred):** voice biometrics. Tech-stack (Pyannote / SpeechBrain / Resemblyzer / AssemblyAI) deliberately deferred.

- Spec: `docs/superpowers/specs/2026-05-04-speaker-recognition-design.md`
- v1 plan: `docs/superpowers/plans/2026-05-04-speaker-recognition-v1-attendee-match.md`
- API: `POST /api/recordings/[id]/speaker-suggestions/{accept,dismiss}`.

## Folder suggestion (G-M12, shipped 2026-05-04)

After `generate_title_summary` finishes for any recording (Loom or Granola) that arrived with no `folder_id`, a `suggest_folder` pg-boss job runs the user's note + their existing folders through Haiku 4.5 and persists `media_objects.suggested_folder_id` only when the model returns `confidence === "high"` AND the suggested folder is in the user's actual folder list (hallucination defense).

- **Schema columns:** `suggested_folder_id`, `suggested_folder_at`, `suggested_folder_dismissed_at` on `media_objects` (migration `0019_folder_suggestion.sql`).
- **UI:** `<FolderSuggestionPill />` on dashboard cards. ✓ accepts via `POST /api/recordings/[id]/suggested-folder/accept`. ✗ dismisses via `POST /api/recordings/[id]/suggested-folder/dismiss`. Toast via the already-mounted sonner `<Toaster position="bottom-right" />`.
- **Classifier model:** `LLM_CLASSIFIER_MODEL` env var (defaults to `claude-haiku-4-5-20251001`).
- **Cost:** ~$0.005 per note. Best-effort; failures never block the title/summary write.

## Stage 4 — Desktop M2 (✅ shipped 2026-05-04)

Premium recorder milestone. Spec: [`docs/superpowers/specs/2026-05-04-desktop-app-m2-premium-recorder-design.md`](docs/superpowers/specs/2026-05-04-desktop-app-m2-premium-recorder-design.md). Plan: [`docs/superpowers/plans/2026-05-04-desktop-app-m2-premium-recorder.md`](docs/superpowers/plans/2026-05-04-desktop-app-m2-premium-recorder.md). Phase-by-phase status in [`ROADMAP.md`](ROADMAP.md).

**What landed:**
- **Composite recorder.** `CompositeRecorder` (AVAssetWriter + CIContext + CIBlendWithMask radial gradient for circle alpha) consumed by `RecorderViewModel.startLocalRecording` / `stopLocalRecordingAndUpload`. Composite MP4 uploads through the existing R2 multipart pipeline as the `composite` track. Inputs: `ScreenCaptureCoordinator.onScreenSampleBuffer`, `CameraCaptureCoordinator.shared` (single-source-of-truth camera), `MicrophoneCaptureCoordinator` on AVAudioEngine + `setVoiceProcessingEnabled(true)` (AEC).
- **Recording HUD.** `VideoRecordingWindowController` floating top-center pill: pulsing red dot + REC label + mono elapsed timer + 5-bar live audio meter + stop + discard. `sharingType = .none`.
- **Source picker.** `SourcePickerCard` exposes camera + mic device dropdowns, persisted via UserDefaults.
- **Permissions preflight.** `PermissionChecker` + `PermissionsView` checklist (camera / mic / screen-recording / accessibility) with Granted/Denied/Not-asked pills + Request / Open Settings buttons. Auto-refresh on `NSWindow.didBecomeKeyNotification`.
- **Global hotkeys.** Carbon `RegisterEventHotKey` wrapper. ⌥⇧B toggles bubble; ⌥⇧R toggles recording. Bridge: `RecorderCommands.toggleRecording` NotificationCenter broadcast. Menubar mirrors with `Start Recording` + `Show/Hide Bubble Overlay` items.
- **Bubble overlay.** Fullscreen-overlay architecture (one stationary panel that NEVER moves; bubble is a moving subview; 60Hz cursor polling toggles `ignoresMouseEvents` over the circular hit region). Eliminates macOS native tiling + Chrome split-view snap zones. Scroll-wheel resize (90–360 pt, ⌥/⇧ for fine). `sharingType = .none`.
- **Singletons** (`CameraCaptureCoordinator.shared`, `BubblePositionController.shared`) provide single-source state shared across AppDelegate (overlay) and RecorderViewModel (compositor).

**Pending:** user E2E smoke (record → stop → upload → playback on share page).

## Stage 5 — Desktop M3 (✅ shipped 2026-05-04, visual restructure)

Granola-grade shell. Spec: [`docs/superpowers/specs/2026-05-04-desktop-app-m3-visual-restructure-design.md`](docs/superpowers/specs/2026-05-04-desktop-app-m3-visual-restructure-design.md). Plan: [`docs/superpowers/plans/2026-05-04-desktop-app-m3-visual-restructure.md`](docs/superpowers/plans/2026-05-04-desktop-app-m3-visual-restructure.md). Phase-by-phase status in [`ROADMAP.md`](ROADMAP.md).

**What landed:**
- Design system under `UI/DesignSystem/`. Tokens: `DSColor` (light/dark RGB pairs), `DSSpacing` (4pt rhythm), `DSRadius`, `DSShadow`, `DSFont` (Inter + JetBrains Mono with system fallback), `LoomolaMotion`. Bundled fonts under `Resources/Fonts/`, registered at app init.
- Branded controls (`UI/DesignSystem/Controls/`): `PrimaryButton`, `SecondaryButton`, `IconButton`, `SegmentedControl`, `Field`, `FieldPicker`, `Pill`, `StatusDot`. Replace every `.borderedProminent` / default Picker / system text input.
- Custom title bar (`Shell/CustomTitleBar.swift`) — wordmark + settings gear + account avatar. System title hidden.
- Per-state home views (`UI/Home/`): `IdleHomeView` (Capture headline + hero card with SegmentedControl + CTAs + inline mic/cam pickers + meeting prompt + Recent strip), `RecordingHomeView` (centered timer + waveform + Stop/Discard, replaces idle while recording), `PermissionsHomeView` (hero state for missing perms), `SignedOutHomeView` ("Capture you own." brand moment).
- Settings sheet (`Shell/SettingsSheet.swift`) — Sources, Permissions (when needed), Integrations, Account, Diagnostics. Receives view model via `.environmentObject`.
- Account popover (`Shell/AccountMenuPopover.swift`) — anchored to title-bar avatar.
- Recent strip (`UI/Recent/`) — last 4 recordings/notes with thumbnails. New `GET /api/recordings/recent` web endpoint with inlined presigned thumbnail URLs (no N+1). Auto-refreshes on app activation, after upload, every 60s.
- Router refactor: `MainRecorderView` 947 → 205 lines (78% cut). All M2-era inline private structs deleted.

**Pending:** user E2E (cold-launch, idle home, start/stop video, start/stop audio, settings sheet, sign-out).

## Recent web work

- G-M14 — Notes bulk select / delete / move. Mirrors `RecordingsGrid` UX. Reuses type-agnostic `/api/recordings/bulk-delete` and `/folder` endpoints.
- G-M15 — Notes-list attachment thumbnails (1/2/2x2 grid), back-button → `?tab=notes`. New `listImageAttachmentsForMediaIds` query (single round trip).
- G-M16 — Desktop AEC for mic via `AVAudioEngine.inputNode.setVoiceProcessingEnabled(true)`. No more participant-voice doubling when recording over speakers.
- G-M17 — AI notes scaling for hour+ to multi-hour meetings. Schema cap raised, `maxOutputTokens: 32000`.
- Share-link previews — `/v/:slug` generates Open Graph/Twitter metadata and `GET /api/v/:slug/thumbnail.jpg` serves social-preview thumbnails for public, ready recordings. Locked/not-ready/missing links return the generic Loomola image. Slack/Discord cache exact URLs, so use a query string when retesting an already-pasted link.

## Granola-alt (in progress)

A second product (audio meeting notes) built on top of this same backend. Spec: [`docs/superpowers/specs/2026-04-28-granola-clone-design.md`](docs/superpowers/specs/2026-04-28-granola-clone-design.md).

- **G-M1 shipped:** six new Postgres tables (`notes`, `people`, `speaker_assignments`, `dictionary_terms`, `transcript_chunks`, `summary_embeddings`), four extended tables (`media_objects`, `transcripts`, `ai_outputs`, `brand_profiles`), pgvector extension, HNSW vector indexes, RLS policies, Supabase Realtime publication on `ai_outputs`, and thin CRUD API routes for the new entities.
- **Schema additions you'll see:** `media_objects.attendees` (jsonb of person UUIDs), `media_objects.r2MixedKey` (mic+system mixed mono audio), `media_objects.meetingDetectedApp`, `media_objects.sourceContextHint`, `media_objects.obsidianSyncedAt`, `transcripts.provider` (default `deepgram`), `ai_outputs.generationStatusValue` (`pending|streaming|complete|failed`), `brand_profiles.meetingNotesVaultPath`.
- **No UI yet** — that lands in G-M4 (`/notes/:id`) and G-M5 (tabbed dashboard).
- **Feature flag:** every Granola API route checks `ENABLE_GRANOLA === 'true'`. When false / unset, the routes return 404 and Loom-only deploys stay dark.
- **Provider abstraction:** env vars `LLM_PROVIDER`, `LLM_MODEL`, `EMBEDDING_PROVIDER`, `TRANSCRIBE_PROVIDER` allow swapping providers without code changes.
- **`INTEGRATION_API_TOKEN`:** bearer token for upcoming LLM-accessible export endpoints (lands in G-M11). Do NOT expose this in client code; server-only.

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
