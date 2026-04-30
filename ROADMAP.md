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

## Stage 1.10 — Share-page + brand-form polish

| What it ships |
|---|
| **Share-page premium pass.** Watch-first surface gets a Loom-feel polish: title band sits flush-left to the page edge as a compact "page header" tag (cut from `py-8/12` to `py-4/5`, `28px` size), centered video below at `max-w-5xl`, accent-colored playhead + scrubber + chapter fills, accent fade strip below the brand header, top radial brand-color glow, off-white Plyr controls, smaller scrubber thumbs without rings, hover-scrub thumbnails preserved, `Sparkles` icon dropped from the Summary block. Brand-name text now hides automatically when a logo is present (logos almost always already contain the wordmark). |
| **Brand form polish.** Logo pickers replaced the native file-input chrome (which was rendering "**N**o file chosen" truncated to "N." in the narrow grid column) with a custom button + filename label. Client-side validation (size + MIME) runs on selection — Next.js `serverActions.bodySizeLimit` was bouncing oversized uploads at the request body before our server validation ran, so the previous behavior was a silent failure on save. Both pickers align by top with a single shared format/size note ("PNG, JPG, WebP, or SVG · up to 2 MB") below the grid. Page-theming intro paragraph clarifies that each field actually renders on the share page (tagline, font family, CTA pill, footer text). |
| **Mobile responsive pass.** Each surface (dashboard, record, share, edit) audited at ≤ 768px; flex/grid breakpoints tightened, top nav logo collapse fixed, share page stacks cleanly. |

**Status:** ✅ shipped 2026-04-30.

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
