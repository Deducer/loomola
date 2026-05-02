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
| G-M10 | Per-project Obsidian sync | 🚧 partial | Canonical Markdown/JSON export endpoints, brand profile vault path field, manual Save to Obsidian queue, desktop manual pending-writer, 30-second desktop background sync, and moved-file re-sync by Markdown `meeting_id`. Realtime subscriber remains. |
| G-M11 | LLM-accessible API + meeting detection | 📋 spec'd | `INTEGRATION_API_TOKEN`, JSON/zip export endpoints, NSWorkspace meeting detection, Chrome extension content scripts, auto-arm UX. |

## Open follow-ups (next milestones to spec)

| Topic | Why | Rough effort |
|---|---|---|
| **Chrome extension companion** | Frameless circle bubble (true Loom parity for web). Loom's own web product is also a Chrome extension; document Picture-in-Picture is the closest pure-web gets, and it always shows a titlebar (browser security requirement). | ~1 day for MVP |
| **macOS desktop / menubar app** | **Early dev app, ready for first manual test.** Native Swift/ScreenCaptureKit app in [`desktop/`](desktop/) can sign in, list capture sources, show a live camera bubble, and upload a first-display MP4 as the composite track. Still missing exported bubble compositing + raw tracks. Spec: [`docs/superpowers/specs/2026-04-27-macos-desktop-app-design.md`](docs/superpowers/specs/2026-04-27-macos-desktop-app-design.md). Plan: [`docs/superpowers/plans/2026-04-27-macos-desktop-app.md`](docs/superpowers/plans/2026-04-27-macos-desktop-app.md). | ~1–2 weeks to Loom-like v1 |
| **Custom domains per brand** | `videos.acme.com` CNAME → VPS, served as the brand's share-page surface. Pairs with Brand Layer 2. | ~1 day infra + DNS setup |
| **Custom-font upload for brand profiles** | Today's `fontFamily` field is Google Fonts only — typing a foundry name (Söhne, TT Norms, "Test the Future", etc.) silently 404s and falls back to system sans. Add `.woff2` upload slots (regular + bold + italic) on the brand form, store under `brand-fonts/<owner>/<id>/`, inject `@font-face` rules in the share-page `BrandFrame`. | ~1–2 hours |
| **Reactions on share page** | Emoji reactions on `/v/:slug`. Spec'd as out of Stage 1; engagement booster. | ~1 day |
| **Re-encoded trim downloads** | Currently trim is JS-side playback clamp only — raw downloads include the trimmed regions. ffmpeg-side re-encode would honor trim. | ~1 day |
| **AI Q&A chat** | Ask questions about a recording (transcript-grounded RAG). | ~2–3 days |
| **Granola-alt** | Audio-only capture product reusing the polymorphic `media_objects` table. | Multi-week |

## Known gaps / bugs being tracked

See open issues: https://github.com/Deducer/loom-clone/issues
