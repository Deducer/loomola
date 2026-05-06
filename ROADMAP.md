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

## Stage 1.7 — Hover-scrub + Brand profile Layer 2

| What it ships |
|---|
| **Hover-scrub thumbnails:** new pg-boss job runs ffmpeg against the composite to build a sprite sheet at adaptive intervals (~50 tiles capped). Storage key is recorded on `media_objects.preview_sprite_key`. New endpoint `GET /api/v/:slug/preview-thumbnails.vtt` serves a WebVTT cue list pointing at slices of the freshly-presigned sprite — Plyr's `previewThumbnails` config picks it up and renders YouTube-style frame previews on seekbar hover. Mirrors the share page's password gate so locked recordings don't leak preview frames. Best-effort: silently disabled when the sprite is missing (recording too short, job pending, or job failed) — no broken UI. |
| **Brand profile Layer 2:** brand profiles gain `tagline`, `font_family`, `cta_label`, `cta_url`, `footer_text` fields. Share page applies the brand's Google Font as the page-wide font when set, surfaces the tagline under the brand name in the header, renders an accent-colored CTA pill in the header for visitors (e.g. "Book a call"), and adds a footer block when configured. Falls back gracefully when fields are empty — Layer 1 (logo + accent) still works on its own. |

**Status:** ✅ shipped 2026-04-26.

**Loom parity gap that's narrower now:** branded share pages (custom font, tagline, CTA, footer) is the "why use this over Loom" story for client-facing work. Custom domains per brand (CNAME `videos.acme.com` → VPS) is the natural next step on this thread but remains deferred.

## Stage 1.8 — Movable bubble + edit page resize + brand-logo hosting

| What it ships |
|---|
| **Movable bubble during recording.** Compositor reads bubble position from a mutable `BubblePositionController` ref each frame; a Chrome `documentPictureInPicture` window opens automatically when recording starts containing only the live camera (clipped to the chosen shape via CSS / clip-path) plus a hover-revealed Stop button. The user drags the pip window itself; we poll its `screenX/Y` each frame and update the controller. The pre-record form's "Bubble position" picker was removed (no fixed positions; you drag during recording). |
| **Bubble cropping fix.** New `clampBubbleCenter` constrains the bubble center so the bounding box (shape-aware: rectangle is wider) stays inside the canvas with a small margin. Wired into both the live compositor and the pre-record `BubblePreview`. Fixes large + rectangle bubbles being half-cropped at corner positions. |
| **Edit page layout fix.** Sticky preview column flexes to fill; settings column capped at 360px. Outer max-width `6xl` → `7xl` for ultrawide. The video preview is now the dominant element on the page. |
| **Brand-logo hosting.** Four hosted logos under `public/brands/` (Project Win, Dissonance Inc., Vayu Labs, Credit Builder Card) so they're served from `loom.dissonance.cloud/brands/<file>.png` instead of breaking when pasted from Google Drive. Long-term: a real file-upload-to-R2 flow on the brand form. |

**Status:** ✅ shipped 2026-04-26.

**Caveat known:** when the user records "Entire screen", Chrome's small window-chrome titlebar on the bubble pip is also visible in the capture (sitting on top of whatever the compositor draws). For tab/window recordings the pip is invisible to the capture. Stage 1.9 ships the Chrome extension that eliminates this caveat for tab/window recordings.

## Stage 1.9 — Chrome extension companion (frameless bubble)

| What it ships |
|---|
| **`extension/` Chrome extension package.** Loads as unpacked from `chrome://extensions`. Manifest V3 service worker routes messages between content scripts. On `loom.dissonance.cloud`: a content script bridges window-postMessage events from the recording app to / from the background. On every other URL: a content script injects an iframe pointing to `https://loom.dissonance.cloud/bubble` whenever the recording app says recording is in progress. The iframe (loom-clone origin) inherits camera permission and renders a frameless circular live-camera that the user can drag anywhere on the captured tab. |
| **New `/bubble` route in the main app.** Renders the iframe contents — a draggable circle with `getUserMedia`. Drag deltas post out to the parent window via cross-origin postMessage; the extension forwards them through the background service worker to the recording tab; the recording tab updates the existing `BubblePositionController` so the compositor draws the bubble at the new fractional position next frame. |
| **`ExtensionBridge` component on the record page.** Posts `recording-started` / `recording-stopped` to the window for the extension to pick up. Listens for `bubble-position` messages coming back. When the extension signals it's installed, the in-app docPiP fallback is suppressed automatically (no double-bubble). |
| **`extension/README.md`** with developer-mode install steps + architecture overview. |

**Status:** ✅ shipped 2026-04-26. **Web Store publishing deferred** (manual review, requires user action). Install as unpacked for now.

**Spec:** `docs/superpowers/specs/2026-04-26-chrome-extension-design.md`

## Stage 1.10 — Share-page + brand-form polish + first-view emails + theme work

| What it ships |
|---|
| **Share-page premium pass.** Watch-first surface gets a Loom-feel polish: title band sits flush-left to the page edge as a compact "page header" tag (cut from `py-8/12` to `py-4/5`, `28px` size), centered video below at `max-w-5xl`, accent-colored playhead + scrubber + chapter fills, accent fade strip below the brand header, top radial brand-color glow, off-white Plyr controls, smaller scrubber thumbs without rings, hover-scrub thumbnails preserved, `Sparkles` icon dropped from the Summary block. Brand-name text now hides automatically when a logo is present. Comment markers on the seekbar now use the brand accent (was hard-coded `var(--accent)`), 1.5px stroke instead of 2px, single initial instead of two. Volume slider switched to neutral off-white (instead of brand accent) and hides until hover. |
| **Brand form polish.** Logo pickers replaced the native file-input chrome (which was rendering "**N**o file chosen" truncated to "N.") with a custom button + filename label. Client-side validation (size + MIME) runs on selection — Next.js `serverActions.bodySizeLimit` was bouncing oversized uploads at the request body before our server validation ran. Both pickers align by top with a single shared format/size note. |
| **Mobile responsive pass.** Each surface (dashboard, record, share, edit) audited at ≤ 768px. |
| **First-view-per-visitor email notifications.** When a new hashed `(IP + UA)` visitor opens a share page, the owner gets a Mailgun email with a UA summary, a link to the share page, and a link to the analytics tab. Subsequent views by that visitor stay silent. Owner views (signed-in same browser) skipped entirely — no analytics row, no email. Insert-vs-update detection uses the `created_at = updated_at` invariant on the views table. |
| **Trim fixes.** Edit-page preview was using a stripped-down Plyr without trim clamp logic — owner saw the full video and assumed trim wasn't working. Same clamp that VideoPlayer uses (`loadedmetadata` seek to `trimStartSec`, `timeupdate` pause+rewind at `trimEndSec`) ported to PreviewPlayer. The "Playback MP4" download is hidden when trim is active (raw R2 object is full-length, would mislead); raw track downloads stay because they're per-track sources unrelated to trim. |
| **Bubble fix.** Window-surface captures (a Chrome window, where the user wants to switch tabs while recording) were triggering the docPiP fallback even though the extension can inject its frameless bubble. docPiP now only fires for `displaySurface === "monitor"` (entire screen). |
| **Brand default theme + viewer toggle.** Brand profile gets `default_theme: 'light' \| 'dark' \| null`. Share pages inject a tiny inline bootstrap script that applies the brand's theme on the visitor's first load (no flash, runs before paint). New `ViewerThemeToggle` (sun/moon icon) in the brand header lets viewers flip; choice persists in their localStorage and wins thereafter. Latent bug fixed in passing: the Layer 2 brand fields (tagline, fontFamily, ctaLabel, ctaUrl, footerText) were saved to DB but never selected back into `RecordingBrand`, so they silently rendered as undefined on share pages — extended `BRAND_SELECT` / `resolveBrand` in both `recordings.ts` and `search.ts` to pull all six fields. |

**Status:** ✅ shipped 2026-04-30.

## Stage 1.99 — Loom v1.0 freeze + multi-product readiness

| What it ships |
|---|
| **`loom-v1.0` git tag.** Reference snapshot of pure Loom for any deploy that wants the screen-recording product alone. Future Granola work lands on `main` behind `ENABLE_GRANOLA=true`; deploys with the flag false (default) see only Loom. |
| **`ENABLE_GRANOLA` feature flag convention.** Documented in CLAUDE.md / AGENTS.md. Set in Doppler per-deploy. Read by every server-side gate the Granola work introduces; client UI hides Notes-tab when false. Single env knob = single switch between products. |
| **No Granola code yet.** Schema, routes, UI all out-of-scope for this stage. M1 onward of Stage 2 lands the actual implementation. |

**Status:** ✅ shipped 2026-04-30.

## Stage 2 — Granola-alt (audio meeting notes)

Self-hosted Granola-faithful AI meeting note-taker built on top of the existing Loom backend. Polymorphic with the existing `media_objects` schema; same R2 / Deepgram / Claude / pg-boss pipeline; same auth / folders / search / brand profiles. Gated by `ENABLE_GRANOLA=true`; pure-Loom deploys don't see any of it.

- **Spec:** [`docs/superpowers/specs/2026-04-28-granola-clone-design.md`](docs/superpowers/specs/2026-04-28-granola-clone-design.md)
- **M1 plan (schema foundations):** [`docs/superpowers/plans/2026-04-29-granola-clone-m1-schema-foundations.md`](docs/superpowers/plans/2026-04-29-granola-clone-m1-schema-foundations.md)
- **M2 plan (audio ingest pipeline):** [`docs/superpowers/plans/2026-05-01-granola-clone-m2-audio-ingest-pipeline.md`](docs/superpowers/plans/2026-05-01-granola-clone-m2-audio-ingest-pipeline.md)
- **M4 plan (notes page):** [`docs/superpowers/plans/2026-05-01-granola-clone-m4-notes-page.md`](docs/superpowers/plans/2026-05-01-granola-clone-m4-notes-page.md)
- **M5 plan (tabbed dashboard):** [`docs/superpowers/plans/2026-05-01-granola-clone-m5-tabbed-dashboard.md`](docs/superpowers/plans/2026-05-01-granola-clone-m5-tabbed-dashboard.md)
- **M6 plan (speaker labeling):** [`docs/superpowers/plans/2026-05-01-granola-clone-m6-speaker-labeling.md`](docs/superpowers/plans/2026-05-01-granola-clone-m6-speaker-labeling.md)
- **M7 plan (shared dictionary):** [`docs/superpowers/plans/2026-05-01-granola-clone-m7-shared-dictionary.md`](docs/superpowers/plans/2026-05-01-granola-clone-m7-shared-dictionary.md)
- **Migration numbering note:** the M1 plan was authored before Stage 1.10 shipped, and references migrations starting at `0010`. The next available number is `0011` — bump every M1 migration filename + journal entry by one (e.g. `0010_pgvector_extension` → `0011_pgvector_extension`, `0011_granola_schema` → `0012_granola_schema`, etc.).
- **Reference repo (worth skimming):** [Zackriya-Solutions/meetily](https://github.com/Zackriya-Solutions/meetily) — Tauri + Rust + Whisper.cpp + Ollama (100% local), MIT-licensed. Architecturally different from us (cloud pipeline vs local) but their `frontend/src-tauri/src/audio_v2/` has solid macOS system+mic capture patterns, and `summary/` has multi-provider prompt structures. Don't port code — borrow patterns.

### Stage 2 status

| # | Milestone | Status | What it ships |
|---|---|---|---|
| G-M1 | Schema foundations + notes API | ✅ shipped | pgvector extension, six new tables (`notes`, `people`, `speaker_assignments`, `dictionary_terms`, `transcript_chunks`, `summary_embeddings`), four extended tables (`media_objects`, `transcripts`, `ai_outputs`, `brand_profiles`), RLS policies, HNSW vector indexes, Supabase Realtime publication on `ai_outputs`, and authenticated CRUD API routes for notes, people, dictionary terms, and speaker assignments. |
| G-M2 | Audio ingest pipeline | ✅ shipped | Backend `type='audio'` upload support behind `ENABLE_GRANOLA`, mic/system R2 multipart completion, ffmpeg audio mixing, waveform generation, Deepgram transcript handoff, and audio queue workers that stay disabled in Loom-only mode. |
| G-M3 | Desktop app — manual recording trigger | ✅ shipped | Desktop dev flow can manually record a Granola audio note with mic + system audio, upload both tracks, complete as `type='audio'`, and hand off to backend mixing, waveform, and Deepgram. Verified by Ian hardware smoke: `ZTrwDqeOop`. |
| G-M4 | `/notes/:id` Granola UI | ✅ shipped | Auth-gated note page for audio media UUIDs/slugs with editable title/body, metadata pills, mixed-audio playback, waveform, and floating transcript card. Verified locally with Ian's `ZTrwDqeOop` audio note. |
| G-M5 | Tabbed dashboard | ✅ shipped | `/` is now Recordings \| Notes behind `ENABLE_GRANOLA=true`; Recordings filters video, Notes filters audio, both share folder/search state, and Notes has a Quick note action. |
| G-M6 | Speaker labeling MVP | ✅ shipped | Deepgram diarization for new transcripts, persisted word-level speaker indexes, `/people` CRUD, and speaker caption assignment popover in the floating transcript card. |
| G-M7 | Shared dictionary | ✅ shipped | `/dictionary` page, bulk paste, canonical/variant terms, Deepgram Nova-2 `keywords` wiring, and transcript variant collapse at webhook persistence. |
| G-M8 | pgvector embedding-on-write | ✅ shipped | `embed_transcript` and `embed_summary` jobs enqueue after transcript/summary writes using OpenAI `text-embedding-3-small`. |
| G-M9 | AI enhancement (user-triggered) | ✅ shipped | "Generate notes" trigger, OpenRouter/Claude enhancement pipeline, Enhanced/Original toggle, and styled Markdown rendering. |
| G-M10 | Per-project Obsidian sync | ✅ shipped | Canonical Markdown/JSON export endpoints, brand profile vault path field, manual Save to Obsidian queue, desktop pending-writer, 30-second desktop background sync fallback, Realtime trigger on `media_objects`, and moved-file re-sync by Markdown `meeting_id`. |
| G-M12 | AI-suggested folder ("Granola pill") | ✅ shipped | After AI title/summary completes for a Loom recording or Granola audio note that has no folder, a small inline pill appears on the dashboard card with the suggested folder + ✓/✗. Backed by a `suggest_folder` pg-boss job, Haiku 4.5 classifier (HIGH-confidence only), and `media_objects.suggested_folder_id` / `suggested_folder_at` / `suggested_folder_dismissed_at` columns. ✓ moves the recording and fires a sonner `toast.success`; ✗ persists a dismissal lock that's cleared on AI regen. Spec: [`docs/superpowers/specs/2026-05-04-folder-suggestion-design.md`](docs/superpowers/specs/2026-05-04-folder-suggestion-design.md). Plan: [`docs/superpowers/plans/2026-05-04-folder-suggestion.md`](docs/superpowers/plans/2026-05-04-folder-suggestion.md). |
| G-M13 | Speaker recognition v1 (calendar-based) | ✅ shipped | After AI title/summary completes for an **audio note** with attendee data, a `suggest_speakers` pg-boss job auto-suggests `speaker_idx → person` mappings using the existing `media_objects.attendees` JSONB + the new `people.is_self` flag. ✓/✗ pill on the transcript card on `/notes/:id`. Same UX shape as G-M12 folder suggestion. Pure logic in `src/lib/speaker-suggestion/` (35 unit tests). Worker filters to type='audio' for v1 because the existing speaker-labeling UI is audio-only; video gets the same flow when video gets a creator-side transcript labeling surface. Spec: [`docs/superpowers/specs/2026-05-04-speaker-recognition-design.md`](docs/superpowers/specs/2026-05-04-speaker-recognition-design.md). Plan: [`docs/superpowers/plans/2026-05-04-speaker-recognition-v1-attendee-match.md`](docs/superpowers/plans/2026-05-04-speaker-recognition-v1-attendee-match.md). |
| G-M13.5 | Speaker recognition v2 (voice biometrics) | 💡 deferred | Per-speaker voice embeddings on `people` rows; cross-recording cosine match identifies the same voice across calls. Covers 3+ person meetings and cases without meeting context. Tech-stack decision (Pyannote vs. SpeechBrain vs. Resemblyzer vs. AssemblyAI) deliberately deferred until v1 has lived for ≥ 2 weeks. Spec details Path C in the same design doc as G-M13. |
| G-M11 | LLM-accessible API + meeting detection | 🚧 partial | `INTEGRATION_API_TOKEN` now works for per-note Markdown/JSON/transcript exports and `/api/export/bundle.zip` bulk Markdown export. Desktop now polls for Meet/Zoom/Teams/Webex, shows a consent-first Meeting ready prompt, auto-suggests the title, and stamps audio notes with detected context. Chrome extension now detects active Meet/Teams/Zoom web tabs and forwards a `meeting-active` signal through a Swift native messaging host; the desktop app can install that host from the UI. |
| G-M14 | Notes bulk select / delete / move | ✅ shipped | The notes list is a client component with the same selection UX as RecordingsGrid: per-row checkbox on hover, shift-click range select, bottom floating action bar with Select all / Move (per folder + Unfiled) / Delete (confirm-twice). Reuses the existing `/api/recordings/bulk-delete` and `/api/recordings/[id]/folder` endpoints (type-agnostic; soft-delete via `deletedAt = now()`). |
| G-M15 | Notes-list attachment thumbnails + back-button tab | ✅ shipped | When a note has attached images, the row icon shows them: 1 = full tile, 2 = halves, 3-4 = 2×2 grid. Replaces the generic waveform icon. New `listImageAttachmentsForMediaIds` query (single round trip, capped at 4 per recording). Note-detail back arrow now navigates to `/?tab=notes` instead of `/`. |
| G-M16 | Desktop AEC for mic | ✅ shipped | `MicrophoneCaptureCoordinator` rewritten from `AVCaptureSession` to `AVAudioEngine` with `inputNode.setVoiceProcessingEnabled(true)`. macOS auto-subtracts the system playback signal from mic input — when the user records over speakers (no headphones), the participant's voice no longer doubles into the recording via mic + system-audio mixing. |
| G-M17 | AI notes pipeline scaling for hour+ to multi-hour meetings | ✅ shipped | `enhancedNotesSchema.summary` cap raised 6000 → 200000 chars. `maxOutputTokens: 32000` on the audio enhance generateObject call so 5-6 hour event recordings render full structured notes instead of truncating mid-sentence. Note page title trimmed `text-[2.35rem]/sm:text-[2.7rem]` → `text-[1.5rem]/sm:text-[1.75rem]` so the body sits above the fold. |

## Stage 3 — Security hardening pack

| What it ships |
|---|
| **HTTP security headers everywhere.** New `src/lib/security/headers.ts` sets CSP (with frame-ancestors `'self'`), HSTS (2-year preload), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, and `X-Frame-Options: SAMEORIGIN`. Wired into `src/middleware.ts` for every response. The `/bubble` route is special-cased with `allowFraming: true` so the Chrome-extension iframe still works on every tab. |
| **Time-bound unlock cookies.** Share-page password tokens now embed `issuedAt` in the signature: `${issuedAt}.${HMAC(slug:passwordHash:issuedAt)}`. Verifier rejects > 24 h old, future-dated (clock skew), tampered, or missing. Existing visitor cookies stop working at deploy boundary; one re-enter — acceptable. |
| **Deepgram callback nonce.** Replaces "HMAC of `recordingId`" (replayable forever) with a one-time nonce: new `webhook_nonces` table, new `issueDeepgramCallbackToken` mints `(nonce, sig)` and persists, new `verifyAndConsumeCallbackToken` atomically marks consumed with `UPDATE ... WHERE consumed_at IS NULL AND expires_at > now() RETURNING`. Webhook route moved from `/api/webhooks/deepgram/[recordingId]/[sig]` to `/api/webhooks/deepgram/[recordingId]/[nonce]/[sig]`. After-deploy: run `node scripts/retrigger-stuck-transcripts.mjs` to re-enqueue any in-flight transcribe jobs. |
| **Persistent comment rate limit.** New `rate_limit_events` table + generic `src/lib/rate-limit/check.ts` helper. The previous in-memory map (lost on every restart, bypassable by triggering a deploy) is gone. Bonus: 5-attempts-per-5-min rate limit on the `/v/:slug/unlock` password endpoint. |
| **Desktop app: Keychain only.** `AuthSessionStore` no longer falls back to a plaintext file based on bundle path. Only `.fileForTesting` mode (test seam) and `.keychain` mode (production) remain. Documented ad-hoc signing workflow in `desktop/README.md` so dev rebuilds don't prompt for Keychain access on every launch. |

**Status:** ✅ shipped 2026-05-04.

**Spec:** [`docs/superpowers/specs/2026-05-04-security-hardening-pack-design.md`](docs/superpowers/specs/2026-05-04-security-hardening-pack-design.md)
**Plan:** [`docs/superpowers/plans/2026-05-04-security-hardening-pack.md`](docs/superpowers/plans/2026-05-04-security-hardening-pack.md)

## Stage 4 — Desktop M2 (✅ shipped 2026-05-04, premium recorder)

| Phase | Status | What landed |
|---|---|---|
| Phase 0 — Foundations | ✅ shipped | `BubblePlacement` value type with 8 unit tests covering Retina + multi-display + clamping + corners. `BubblePositionController` (NSLock-guarded thread-safe placement holder, 4 tests). `RecorderStateMachine` extracting transition table (10 tests). |
| Phase 1 — Composite writer | ✅ shipped | `ScreenCaptureCoordinator.onScreenSampleBuffer` callback + `latestScreenPixelBuffer()`. `CameraCaptureCoordinator.shared` (single-source-of-truth camera session shared between bubble overlay and compositor — no more two-sessions-per-camera). `MicrophoneCaptureCoordinator` on AVAudioEngine + `setVoiceProcessingEnabled` (AEC) + `onSampleBuffer` callback. Real `CompositeRecorder` (AVAssetWriter + CIContext + CIBlendWithMask radial gradient for circle alpha) wired into `RecorderViewModel.startLocalRecording`/`stopLocalRecordingAndUpload`. Composite MP4 uploads through the existing R2 multipart pipeline as the `composite` track. |
| Phase 2 — Recording HUD | ✅ shipped | `VideoRecordingWindowController` floating top-center HUD: pulsing red dot + REC label + monospaced elapsed timer + 5-bar live audio meter + stop + discard. `panel.sharingType = .none` keeps it out of the captured frame. |
| Phase 3 — Source picker | ✅ shipped | `SourcePickerCard` in `MainRecorderView` exposes camera + mic device dropdowns; selections persist via UserDefaults and feed the shared coordinators. SCContentSharingPicker hand-off was already in place from M1. |
| Phase 4 — Permissions preflight | ✅ shipped | `PermissionChecker` (camera / mic / screen-recording / accessibility) + `PermissionsView` checklist with Granted/Denied/Not-asked pills + per-row Request / Open System Settings buttons. Auto-refresh on `NSWindow.didBecomeKeyNotification` so returning from System Settings updates state. Banner mounts at top of the recorder view when required perms are missing. |
| Phase 5 — Menubar quick-record + global hotkey | ✅ shipped | Carbon `RegisterEventHotKey` wrapper (`GlobalHotkey`) registers ⌥⇧B (toggle bubble) and ⌥⇧R (toggle recording). Menubar gets matching `Start Recording` and `Show/Hide Bubble Overlay` items. Bridge from AppDelegate to view model is `RecorderCommands.toggleRecording` NotificationCenter broadcast — `MainRecorderView` subscribes and routes to start/stop based on `activeRecordingKind`. |
| Phase 6 — E2E smoke + docs | ✅ shipped (this entry) | All 56 desktop swift tests passing. Build clean. Final user-driven E2E smoke (record → stop → upload → playback on share page) pending the user's first dogfood session. |

**Bubble polish along the way (all shipped):** menubar Show/Hide toggle with `NSMenuItemValidation` updating the title; bubble overlay subscribes to `BubblePositionController.shared` and publishes a fresh placement on every drag tick; bubble panel marked `sharingType = .none` so the compositor's screen capture is "naked" of the overlay (it composites the bubble independently from the camera coordinator pixel buffer); fullscreen-overlay architecture (one stationary panel that NEVER moves, bubble is a moving subview, 60Hz cursor polling toggles `ignoresMouseEvents` based on hover position over the circular hit region) — fully eliminates macOS native tiling + Chrome split-view snap zones during drag; scroll-wheel to resize the bubble (90–360 pt, ⌥/⇧ for slow/fine); dark `black @ 0.32` placeholder background instead of jarring purple flash on hide.

**Spec:** [`docs/superpowers/specs/2026-05-04-desktop-app-m2-premium-recorder-design.md`](docs/superpowers/specs/2026-05-04-desktop-app-m2-premium-recorder-design.md)
**Plan:** [`docs/superpowers/plans/2026-05-04-desktop-app-m2-premium-recorder.md`](docs/superpowers/plans/2026-05-04-desktop-app-m2-premium-recorder.md)

## Stage 5 — Desktop M3 (✅ shipped 2026-05-04, visual restructure)

The Granola-grade shell. M2 made the *recorder* feel premium; M3 made the *shell around the recorder* feel premium. Six phases, all shipped on 2026-05-04.

| Phase | Status | What landed |
|---|---|---|
| Phase 0 — Foundations | ✅ shipped | Bundled Inter (variable, OFL) + JetBrains Mono (variable, OFL) under `Resources/Fonts/`, registered at app init via `CTFontManagerRegisterFontsForURL`. Token system under `UI/DesignSystem/Tokens/`: `DSColor` (light/dark RGB pairs from spec), `DSSpacing` (4pt rhythm), `DSRadius`, `DSShadow` (3-tier `.dsShadow(.subtle/.raised/.brand)`), `DSFont` (Display.xl/lg, Body.lg/md/sm, Mono.timer/body — Inter + JetBrains with system fallback), `LoomolaMotion` (quick/medium/expressive). The legacy private `Card` primitive in `MainRecorderView` updated to use new tokens (so the shipping cards immediately get the new background/radius/shadow). 5 new design-system tests covering color light/dark divergence, recording-red theme invariance, monotonic spacing/radius scales. |
| Phase 1 — Branded controls | ✅ shipped | 8 control primitives under `UI/DesignSystem/Controls/`: `PrimaryButton` (pill, accent, brand shadow on hover, `.standard`/`.destructive` kind, optional icon + isLoading), `SecondaryButton` (pill, surface bg, border.strong outline), `IconButton` (32×32 circle, SF Symbol or single-letter text), `SegmentedControl` (sliding-thumb via `matchedGeometryEffect`, generic over `Hashable & CaseIterable`), `Field` (text input with focused-accent border, optional leading icon, isSecure for passwords), `FieldPicker` (Menu + custom label, no system PopUpButton chrome), `Pill` (5 kinds: success/warning/recording/muted/accent), `StatusDot` (8px dot + label). |
| Phase 2 — Custom title bar + sheet plumbing | ✅ shipped | `Shell/CustomTitleBar.swift` — 40pt strip with 78pt traffic-light spacer + Loomola wordmark + settings gear + account avatar `IconButton` (renders user's first email letter). System "Loomola Desktop" title hidden via `.windowStyle(.hiddenTitleBar)`. `Shell/SettingsSheet.swift` (placeholder body, populated in Phase 4). `Shell/AccountMenuPopover.swift` — anchored to avatar; email + Open dashboard + Open library + Sign out. Old `BrandLogoMark` private struct moved to `CustomTitleBar.swift` so AppDelegate (menubar icon) and the title bar share it. |
| Phase 3 — Idle home + Recent strip + router | ✅ shipped | `Home/IdleHomeView.swift` — main 95% case. "Capture" headline + hero card (`HeroCaptureSection` with `SegmentedControl` for Video/Audio note + start/stop CTAs + inline mic/cam `FieldPicker`s) + optional meeting prompt card + Recent strip. `Recent/RecentStrip.swift` + `Recent/RecentCard.swift` + `Recent/RecentRecordingsService.swift` — 4-card strip with thumbnails, fed by new `GET /api/recordings/recent?limit=4` endpoint that returns slim DTOs with inlined presigned thumbnail URLs (no N+1). Auto-refreshes on app activation, after upload completes, every 60s. Empty state: "Nothing recorded yet. Hit Start recording or press ⌥⇧R to begin." `MainRecorderView` body splits into `contentForCurrentState @ViewBuilder` routing by `(state, activeRecordingKind, permissions)`; idle case wired to `IdleHomeView`. View model exposes a lazily-built `recentRecordings: RecentRecordingsService` accessor. |
| Phase 4 — Recording home + populated settings sheet | ✅ shipped | `Home/RecordingHomeView.swift` — replaces idle while `activeRecordingKind != nil`. Pulsing red dot, big "Recording" / "Recording audio note" headline, mono timer (handles hour-rollover), 8-bar accent-tinted live audio meter, action cluster (Stop & upload + Discard for video; + Open note for audio). Floating HUD windows continue showing in parallel. `Shell/SettingsSheet.swift` body populated: Sources (camera + mic FieldPickers + Refresh), Permissions (only when missing or denied; status pills + Open Settings deep-links), Integrations (Chrome bridge install + Open extension folder + Sync now), Account (signed-in email + Open dashboard + Sign out), Diagnostics (collapsible — Test video/audio backend + statusMessage shown in mono on bg.subtle code block). View model passed via `.environmentObject`. |
| Phase 5 — SignedOut + Permissions home | ✅ shipped | `Home/SignedOutHomeView.swift` — centered brand moment. 64pt Loomola glyph + "Capture you own." headline (display.xl) + two-line description + Email/Password `Field` inputs (with leading icons) + full-width "Sign in →" PrimaryButton (disabled until both fields populated) + "Trouble signing in?" link to dashboard. Auto-focuses email field. `Home/PermissionsHomeView.swift` — hero state when any required permission missing/denied. Per-row Pill (Granted/Denied/Not asked) + Request / Open Settings actions; success checkmark on grant; auto-completes via `NSWindow.didBecomeKeyNotification` when all required perms granted. "Skip for now" link bypasses for the session. |
| Phase 6 — Cleanup + grep audit + docs | ✅ shipped (this entry) | Deleted `MainRecorderView.swift` private structs: `AppHeader`, `SignedOutView`, `CaptureCard`, `CaptureModeSelector`, `CaptureModeSegment`, `IntegrationsCard`, `IntegrationBlock`, `DiagnosticsCard`, `MeetingPromptView`, `SourcePickerCard`, `CaptureSourcesView`, `SourceRow`, `StatusCard`, `FooterBar`, `Card`, `StatusPill`, `DeveloperToolsDisclosure`, plus the `signedInBody` computed view, the `private enum FocusedField`, and the `private extension DesktopRecordingKind`. Deleted `UI/PermissionsView.swift` (replaced by `PermissionsHomeView`). `MainRecorderView` shrank from 947 → 205 lines (78% cut). Visual regression grep audit: zero non-DesignSystem usages of `borderedProminent`, `windowBackgroundColor`, `controlBackgroundColor`, `Font.system`, `Font.custom` in `UI/`. CLAUDE.md / AGENTS.md / ROADMAP.md updated. 61 desktop swift tests still passing throughout. |

**Pending / out-of-scope deferrals:** user E2E smoke pending dogfood session.

**Spec:** [`docs/superpowers/specs/2026-05-04-desktop-app-m3-visual-restructure-design.md`](docs/superpowers/specs/2026-05-04-desktop-app-m3-visual-restructure-design.md)
**Plan:** [`docs/superpowers/plans/2026-05-04-desktop-app-m3-visual-restructure.md`](docs/superpowers/plans/2026-05-04-desktop-app-m3-visual-restructure.md)

## Stage 6 — Live notes (✅ shipped 2026-05-05, Granola-shape side panel + pause/resume)

For audio notes only; video flow unchanged. Six phases:

- **Phase A — `PauseAdjuster`** (pure-logic struct, 7 unit tests) tracks pause/resume PTS arithmetic so paused gaps are removed. Wired into `MicrophoneCaptureCoordinator` via `pause()`/`resume()`/`isPaused`.
- **Phase B — System audio pause** via `CMSampleBufferCreateCopyWithNewTiming` (SCStream sample buffers are immutable). `AudioNoteRecorder.pause()/.resume()` pause both mic + system audio in lockstep. RecordingHomeView shows Pause↔Resume toggle; pulsing red dot becomes static warning-orange when paused.
- **Phase C — `NotesSidePanelWindowController`** floating ~380×full-visible-height NSPanel anchored to the right edge, mimicking Granola's footprint. Header + title field + big TextEditor + bottom controls. `level = .floating + .canJoinAllSpaces + .stationary` so it follows across spaces. Auto-summons on audio note start.
- **Phase D — debounced autosave** to `PUT /api/notes/<mediaId>`. ~2s idle window; final synchronous flush on Stop & upload before the upload fires so the AI pipeline sees the user's full content.
- **Phase E — pause-aware regen trigger:** no work needed. `generate-title-summary.ts` already reads `notes.body` as `rawNotes` for the LLM prompt.
- **Phase F — tests + smoke:** 7 PauseAdjuster unit tests cover the PTS math. Full E2E pending dogfood session.

**Status:** ✅ shipped 2026-05-05.

## Stage 7 — Desktop stability sprint + Granola-style Recent UX (✅ shipped 2026-05-06)

A high-density bug-fix + polish day after the M3 dogfood surfaced multiple sharp edges, plus the start of multi-folder migration.

| Topic | Status | What landed |
|---|---|---|
| **Audio note crash on start** | ✅ shipped | `AudioAssetWriter` rewritten from `AVAssetWriter + AVAssetWriterInput` (which throws an uncatchable `NSInvalidArgumentException` from inside AVFCore on macOS 26.4.1 even with valid AAC settings) to `AVAudioFile` (uses `ExtAudioFile` underneath — different orchestration layer, same AAC m4a output). Mic flow now passes the engine tap's PCM buffer directly (no CMSampleBuffer round-trip on the file-write path). `377f4bd`. |
| **VPIO ducking system audio** | ✅ shipped | macOS's voice-processing IO unit was muting Zoom/Meet/music for the duration of recording. `AudioNoteRecorder` no longer calls `setVoiceProcessingEnabled(true)` by default. Server-side mix-audio job can dedup if echo ever shows up; headphone users (typical recording-a-call setup) have no acoustic feedback path so no echo to begin with. `377f4bd`. |
| **`URL.appending(path:)` percent-encoding** | ✅ shipped | `baseURL.appending(path: "/api/recordings/recent?limit=4")` produced `/api/recordings/recent%3Flimit=4` — desktop Recent strip silently empty forever. Switched to `URL(string:relativeTo:)` which parses path + query the way HTTP expects. Lifted to `BackendURLBuilder` + 4 regression tests. `c470373`, `0405a7f`. |
| **Auth tokens → file storage by default** | ✅ shipped | macOS Keychain re-prompts for the login password every time the app's binary is re-signed (every install). Six prompts per testing session was unworkable. Default flipped from `.keychain` → `.file` (~/Library/Application Support/LoomDesktop/auth-session.json, 0600 perms). Same security ceiling for a single-user dev tool — anyone with the macOS account can read Keychain anyway. `31f44ce`. **Note:** this reverses the Stage 3 "Keychain only" stance. The Stage-3 reasoning (no path-based silent fallback) still holds — file is now the explicit default, not a heuristic. |
| **Logger-based observability** | ✅ shipped | Switched the `[recent]` / `[backend]` print statements to `Logger(subsystem: "cloud.dissonance.loom.desktop", category: ...)` at `.notice` level. Boot log in AppDelegate; restoreSession start/success/failure/timeout in RecorderViewModel; recent service creation + refresh; backend GET URL + status + body preview on non-2xx. Visible in `log show --predicate 'subsystem == "cloud.dissonance.loom.desktop"'`. `31f44ce`. |
| **`durationSeconds` JSON shape** | ✅ shipped | `media_objects.duration_seconds` is a Drizzle `numeric` column → arrives as a JS string. `/api/recordings/recent` was emitting it as-is, which Swift's strict `JSONDecoder` rejected → Recent strip silently empty. Server now coerces to `Number()` before serializing. Audited every other desktop-facing endpoint; only this one was affected. `c0232a8`. |
| **`restoreSession` 10s timeout** | ✅ shipped | `client.auth.setSession(...)` was empirically hanging forever on macOS 26.4.1, leaving the user pinned on the signed-out screen. Wrapped in a continuation-based race against a 10s sleep with a lock-protected one-shot resolver — neither task can block the other (TaskGroup-with-cancel doesn't help because cancellation waits for the hung child to actually exit). After 10s status flips to "Couldn't restore session within 10s. Sign in again." `583004d`. |
| **Recent populate-on-launch race** | ✅ shipped | `signIn()` flips state to `.preparingPermissions` BEFORE `apply()` runs from the network task continuation. That intermediate state often renders IdleHomeView, which constructs the recent service with `accessToken` still nil. Init refresh fails with `missingAccessToken`, the failure caches as `hasLoaded=true items=[]`, strip stays empty until 60s timer fires. Fix: `apply(session:)` explicitly calls `_recentService?.refresh()` after setting the token. `ec87d31`. |
| **Granola-style Recent rows** | ✅ shipped | RecentNoteRow gets folder pill (right side, hidden when unfiled + not hovering), folder picker popover with checkmark on current selection, time-of-day in mono-digit right column, hover bg highlight. Folder data flows through `/api/recordings/recent` (one extra round trip to listFoldersForOwner only when at least one item is filed) and a new `GET /api/folders` listing endpoint. `ec87d31`. |
| **Recent video cards** | ✅ shipped | 320×180 (true 16:9, triple the original 140×84). 1px border + `.dsShadow(.subtle)` at rest, `.raised` on hover. 3 cards per row instead of 4. Spacing bumped `lg → xl`. `be0396b`. |
| **Recent date grouping** | ✅ shipped | Audio note rows grouped by date — Today / Yesterday / Mon, May 4 / Apr 28 / Dec 12, 2025. Lifted to `RecentDateGrouping` with parameterized now/calendar so it's testable; 11 dedicated unit tests. `0ff276b`. |
| **Multi-folder Phase 1** | ✅ shipped | New `media_folder_assignments` join table + composite PK + indexes + RLS + idempotent backfill. All folder writes dual-write (legacy column + join table). New endpoints: `GET/POST /api/recordings/{id}/folders`, `DELETE /api/recordings/{id}/folders/{folderId}`. 12 DB-backed tests covering dual-write, idempotency, FK cascade, bulk lookup. Reads still go through `media_objects.folder_id`. Spec: [`docs/superpowers/specs/2026-05-06-multi-folder-assignments-design.md`](docs/superpowers/specs/2026-05-06-multi-folder-assignments-design.md). `05f691d`. |
| **Multi-folder Phase 2** | 🟡 next | Read flip — rewrite reads in `listRecordings`, search.ts, dashboard sidebar, recent route. Update web folder pill UI to multi-folder ("+N more"), drag-and-drop additive semantics. Update desktop folder picker to multi-select with checkboxes. Update Recent row pill to handle arrays. ~6 hours. |
| **Multi-folder Phase 3** | 💡 deferred | Drop legacy `media_objects.folder_id` column. ~1 hour. After ≥1 week soak post-Phase 2. |

**Spec:** [`docs/superpowers/specs/2026-05-06-multi-folder-assignments-design.md`](docs/superpowers/specs/2026-05-06-multi-folder-assignments-design.md) (covers all three multi-folder phases)

## Stage 8 — Granola-grade desktop audio note workspace (✅ shipped 2026-05-06)

A second high-density polish day after the Stage-7 dogfood. The audio note flow goes from "functional capture" to "premium note workspace" — single window, inline-with-traffic-lights chrome, AI re-run from the desktop, drag-drop image attachments, hidden markdown syntax. No new specs; iterated live on a real recording session.

| Topic | Status | What landed |
|---|---|---|
| **Granola-shape note workspace** | ✅ shipped | `NoteWorkspaceView` is now a full editor surface. Big serif title (`Display.xl`), three meta pills (Today / Me / Add to folder), live-tokenized markdown body via `MarkdownTextEditor` (NSTextView wrapper — supports `#`/`##`/`###`, `**bold**`, `*italic*`, `` `code` ``), bottom-pinned attachments strip with paperclip header. Folder pill triggers a popover with inline new-folder creation. ⋯ menu hosts Copy text / Open on web / Discard / Move to trash. `b4555ff`, `76d8078`, `19b8459`, `4609638`. |
| **Drag-and-drop image attachments** | ✅ shipped | Drag any image (or file URL with image type) onto the workspace → centered "Attach images" overlay during drag, multipart upload via `BackendClient.uploadNoteAttachment`, optimistic local thumbnail, bottom strip update. Attachments fetched on appear via `listNoteAttachments`. `607c343`, `1f98c3e`. |
| **Click thumbnail → fullscreen preview** | ✅ shipped | Quick-Look-style overlay anchored to the workspace; click outside or × dismisses. `bbfd93b`. |
| **Right-click thumbnail → Remove** | ✅ shipped | Optimistic delete via `DELETE /api/notes/<id>/attachments/<attachmentId>` with snapshot rollback on failure. `bbfd93b`. |
| **Generate notes pill (review mode)** | ✅ shipped | Bottom-anchored green ✦ pill in workspace's review mode. POSTs `/api/notes/<id>/enhance` (existing pg-boss `generate_title_summary` re-run), polls `GET …/enhance` every 3s up to 60s; on `complete` updates title + body bindings in place. Flushes pending autosave first so the AI run picks up the user's latest typed notes. `bbfd93b`. |
| **Markdown syntax hidden in renderer** | ✅ shipped | The `# ` / `## ` / `**…**` / `*…*` / `` `…` `` source markers render at 0.01pt + `NSColor.clear` so they collapse to zero visual width; the styled content (heading-size, bold, italic, mono) renders normally. Underlying string still holds valid markdown so saves to `/api/notes/<id>` are unchanged and undo/redo works. `7cfd4a4`. |
| **One-window architecture (no side panel)** | ✅ shipped | Workspace lives in the main window via `MainRecorderView.noteTarget: NoteWorkspaceTarget?`. Set on audio-recording start (auto), set on Recent audio-row click, cleared by the home/back button. The right-anchored NSPanel approach was deleted (`NotesSidePanelWindowController.swift` removed) because `canJoinAllSpaces + stationary` painted it on every Space simultaneously and Mission Control couldn't drag it between desktops. The main window can now be shrunk to a Zoom-friendly width that the OS remembers, and dragged between desktops normally. `0baba09`. |
| **Tall unified system title bar** | ✅ shipped | `WindowChrome.applyTallTitleBar` sets `window.toolbarStyle = .unified` + an empty `NSToolbar`, growing the title-bar area to ~52pt. macOS recenters the traffic lights vertically with breathing room above. `.toolbarBackground(.hidden, for: .windowToolbar)` keeps the title bar visually continuous with the canvas. `143788c`. |
| **Toolbar items via SwiftUI `.toolbar`** | ✅ shipped | Home/⋯ (workspace mode) and sidebar/wordmark/settings/avatar (home mode) are first-class `ToolbarItem`s — clickable, inline with the traffic lights, no second row taking up vertical space. Workspace mode declares its toolbar inside `NoteWorkspaceView` so its ⋯ menu logic stays close to its state; home mode declares in `MainRecorderView`. SwiftUI swaps the active toolbar items as the view tree changes. `CustomTitleBar.swift` and the workspace's internal title-bar HStack are both retired. `3855de2`. |
| **RecordingStatusPill on home view** | ✅ shipped | When `activeRecordingKind == .audio && noteTarget == nil` (user closed the workspace mid-recording), a persistent bottom-anchored pill renders: pulsing red dot · "Recording" · timer · meter · Open note · Stop. One tap returns to the workspace; one tap stops & uploads. Eliminates the "did I forget I'm recording?" footgun. `143788c`. |
| **Recent video cards rebalanced** | ✅ shipped | 320×180 → 264×148 (still 16:9), gap `xl → lg`. 3 cards × 264 + 2 × 16 + 64pt padding = 824pt — fits comfortably in the default 1080pt window AND the 920pt min. Audio note tab unchanged. Reverses Stage-7's bump that was tuned for a 1080pt window only. `1fdf83b`. |
| **Default window size + min** | ✅ shipped | `defaultSize(width: 1080, height: 740)` + `minWidth: 920, minHeight: 620` on the WindowGroup. ~half a 1080p / ~third of a 1440p screen — small enough to live next to a Zoom call. `bbfd93b`. |
| **Workspace content readable cap** | ✅ shipped | `frame(maxWidth: 640, alignment: .leading).frame(maxWidth: .infinity, alignment: .center)` — narrow windows fill, wide windows give a centered 640pt readable column. Recording control bar capped at 480pt. `0baba09`. |
| **Audio recording single UI** | ✅ shipped | Removed competing recording surfaces — the small floating capsule and `RecordingHomeView` are suppressed for audio mode. The workspace is the single audio recording UI. `8120a08`. |

## Open follow-ups (next milestones to spec)

| Topic | Why | Rough effort |
|---|---|---|
| **Multi-folder Phase 2 (read flip)** | Cut Loomola over to the new `media_folder_assignments` join table everywhere — list views, search, recent route, desktop picker, dashboard pills. Granola-parity filing in user-visible UI. Spec: [`2026-05-06-multi-folder-assignments-design.md`](docs/superpowers/specs/2026-05-06-multi-folder-assignments-design.md). | ~6 hours focused |
| **Live transcription drawer (desktop)** | Granola's killer in-meeting moment — transcript drawer slides up from the bottom of the workspace, fills with rounded paragraph cards as people speak, two-tone rendering for confirmed vs in-progress text. Closes the most-felt gap to Granola during an active call: "look up what was just said" + visible proof the recording is capturing audio correctly. Deepgram streaming WebSocket (separate from our existing async/batch path), short-lived auth keys minted by `/api/transcribe/live-token`, drawer hosted inside `NoteWorkspaceView` with the chevron-up affordance already in place. Spec: [`2026-05-06-live-transcription-drawer-design.md`](docs/superpowers/specs/2026-05-06-live-transcription-drawer-design.md). | ~3.5 days for v1 (no live diarization) |
| **Floating recording pill (desktop)** | Granola's small vertical capsule overlay — Loomola brand mark + 3-bar live audio meter — that floats on every Space and every desktop while audio is recording. Hover reveals a 6-dot drag grip (reposition anywhere); click navigates back to the open note. Removes the "did I forget I'm recording?" footgun even when the user is in a different app/Space (the Stage-8 in-app `RecordingStatusPill` retires once this ships). Pure desktop UI — no API/DB changes. Pairs naturally with the live transcription drawer; both are in-meeting moments and could ship together. Spec: [`2026-05-06-floating-recording-pill-design.md`](docs/superpowers/specs/2026-05-06-floating-recording-pill-design.md). | ~1 day |
| **AI Q&A on a single note / recording** | Granola's "Ask anything" surface — chat-style interface grounded in the note's transcript + summary. Embeddings exist (`summary_embeddings`, `transcript_chunks`) so the retrieval pipeline is half-built. The killer Granola moment that Loom doesn't ship; would beat both. Pairs well with the live transcription drawer above — shared per-utterance timestamps would let users click a Q&A answer and jump to the moment in audio. | ~2–3 days |
| **AI Q&A across all notes** | Same pattern but global — search semantically across the user's entire library. Embeddings already cover this; differs only in the retrieval scope and a global "Ask Loomola" entry point. | ~2 days on top of single-note Q&A |
| **Note templates** | Granola's 30+ templates (1:1, retro, weekly review, customer call, etc.) each shape the AI title/summary prompt. Picker on `/notes/:id` + per-template prompt under `src/lib/ai/templates/`. Low-effort high-premium-feel. | ~1–2 days for v1 with 5–8 templates |
| **Speaker recognition v2 (voice biometrics)** | Cross-recording voice ID for 3+ person meetings + meetings without calendar. Tech-stack decision (Pyannote / SpeechBrain / Resemblyzer / AssemblyAI) deliberately deferred until v1 has lived ≥2 weeks. Spec'd as Path C in the G-M13 design doc. | ~1 week once tech chosen |
| **Custom domains per brand** | `videos.acme.com` CNAME → VPS, served as the brand's share-page surface. Pairs with Brand Layer 2. | ~1 day infra + DNS |
| **Custom-font upload for brand profiles** | Today's `fontFamily` field is Google Fonts only — typing a foundry name (Söhne, TT Norms, etc.) silently 404s and falls back to system sans. Add `.woff2` upload slots (regular + bold + italic) on the brand form, store under `brand-fonts/<owner>/<id>/`, inject `@font-face` rules in `BrandFrame`. | ~1–2 hours |
| **Calendar-aware pre-meeting prompt** | Today the desktop fires "Meeting ready" once a Meet/Zoom/Teams *window* is detected. Granola-style also fires N minutes before a *scheduled* event. EventKit integration + permission flow + 1-minute-before notification. Parse Meet/Zoom/Teams URLs from event description. **Constraint:** never fire reminders *after* the meeting has started. | ~half day |
| **Folder customization (color + emoji icon)** | Granola lets you tag folders with custom emoji + colors that surface on the dashboard sidebar. Adds `folders.icon` (text/emoji) + `folders.color_hex`. Pairs nicely with multi-folder Phase 2. | ~half day |
| **On-screen content sanitization (privacy redaction)** | Live-blur or block-out sensitive on-screen content during recording. Two-mode: (a) regex auto-detection (email, JWT, AWS keys), (b) user-defined regions/windows masked. The compositor is already CIContext-based; insert a CIFilter pass per frame. | ~3–4 days for MVP |
| **Reactions on share page** | Emoji reactions on `/v/:slug`. Spec'd as out of Stage 1; engagement booster. | ~1 day |
| **Re-encoded trim downloads** | Trim is currently JS-side playback clamp; raw downloads include trimmed regions. ffmpeg-side re-encode would honor trim. | ~1 day |
| **Multi-folder Phase 3 (drop legacy column)** | After ≥1 week soak post-Phase 2, drop `media_objects.folder_id`. | ~1 hour |
| **Native iOS app** | ReplayKit-based recording, mobile audio note capture. Single-user-account-only for v1. The biggest gap to Loom + Granola but the highest effort. | Multi-week |
| **Native Windows app** | Direct gap to Loom (which has Windows). Lower priority than iOS for our user base. | Multi-week |

## Known gaps / bugs being tracked

See open issues: https://github.com/Deducer/loom-clone/issues
