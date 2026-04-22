# Loom Clone — Stage 1 Design Document

**Author:** Ian Cross
**Date:** 2026-04-22
**Status:** Draft, pending review

---

## Overview

A self-hosted Loom replacement optimized for a single creator (Ian) publishing branded share pages under multiple personal/business identities (Vayu Labs, Project Win, personal). Stage 1 is a web-based recorder that captures screen + camera bubble, uploads directly to Cloudflare R2, and serves a polished viewer experience with transcripts, AI-generated metadata, and timestamped comments.

The underlying data model is intentionally polymorphic (`media_object.type = 'video' | 'audio'`) so future audio-first products (Granola-alt, MacWhisper-alt) can reuse the backend, transcription pipeline, brand profiles, and share-page infrastructure without schema changes.

---

## Goals

- Replace Loom's $20/mo subscription with a self-hosted tool running on existing Hostinger VPS + Coolify infrastructure.
- Match Loom's core workflow: record → share link → viewer watches with transcript/chapters/comments.
- Support Layer 1 brand profiles (accent color + logo) that apply to share pages.
- Support 4K recording (creator uses Opal C1 and Lumina cameras on an M4 Pro Mac mini with 48GB RAM).
- Provide raw stream exports (separate screen/camera/mic/system-audio tracks) for YouTube tutorial editing workflows in DaVinci / Final Cut / ScreenStudio.
- Keep operating cost under ~$10/mo total, excluding existing service accounts.
- Design the backend as a reusable "media + transcript + AI" platform for future audio-based products.

## Non-goals (Stage 1)

- Native macOS menubar app — separate future spec; backend designed to accommodate it.
- iOS app — far-future, separate spec.
- Multi-tenant workspaces / team invites.
- Brand profile Layers 2–5 (full theming, CTAs, custom domains, branded recorder chrome).
- In-browser editor beyond trim start/end (no blur, no middle-cuts, no drawing).
- AI Q&A chat over a recording.
- Webhook outbound integrations.
- Emoji reactions on videos.
- Granola-style meeting transcription capture — future spec, will reuse this backend.

---

## High-Level Architecture

**Single Next.js 15 application, one Docker container, deployed via Coolify on Hostinger VPS.**

### Tiers (logical, not physical)

- **Web tier** — Next.js App Router, UI, API routes, Supabase-backed auth (single user), webhook receivers.
- **Worker tier** — `pg-boss` workers running in the same Node process, pulling jobs from Supabase's Postgres. No Redis. If scale demands it, workers can later split into a separate container.
- **External services:**
  - **Cloudflare R2** — all media storage (composite video, raw track exports, thumbnails, brand logos, future audio). Private bucket; playback via 1-hour signed URLs.
  - **Deepgram** — canonical transcription (Nova model), webhook callback for completion.
  - **Anthropic Claude Sonnet 4.6** — LLM for title/summary/chapters/action items. Accessed via Vercel AI SDK (provider-agnostic abstraction); default model configurable per env var.
  - **Supabase** — Postgres (data), Auth (single creator), small asset storage if needed.
  - **Resend** — transactional email (comment notifications).
  - **Doppler** — centralized secrets management across projects; CLI injects env at container startup.

### Deployment shape

- Private GitHub repo, auto-deployed via Coolify's GitHub app connector on push to `main`.
- Dockerfile at repo root, multi-stage build based on `node:22-alpine` (Node 22 LTS, avoiding the Node 24 ArrayBuffer bug that broke Cap.so).
- Coolify configuration: domain `loom.dissonance.cloud`, port 3000, Traefik auto-TLS.
- One secret in Coolify: `DOPPLER_TOKEN` (service token). All other secrets flow through Doppler.

### One-line data flow

```
Record (browser) → direct upload to R2 (S3-compatible multipart, during capture)
  → POST /api/recordings/:id/complete
  → enqueue transcribe + thumbnail jobs
  → Deepgram webhook → save transcript → enqueue LLM jobs
  → LLM completion → media_object.status = 'ready'
  → viewer watches at /v/:slug with brand profile applied
```

### Deliberate non-choices

- **No Vercel** — consolidation, user doesn't currently operate any Vercel projects.
- **No Redis** — pg-boss suffices at this scale.
- **No n8n coupling for the core pipeline** — n8n remains in use for unrelated automations (Athena Core, bookmarks, meeting intelligence); Loom's pipeline is app code to keep the failure surface small.
- **No Cloudflare Stream / Mux** — R2-direct was chosen for zero-egress cost, vendor consolidation, and simplicity. Trade-off: no adaptive bitrate streaming; mobile-on-cellular viewers will eat the full composite file.
- **No MP4 transcoding** — WebM (VP9 + Opus) plays in all target browsers natively; no server-side re-encode for v1.
- **No microservices** — one app, one container.

---

## Data Model

Postgres via Supabase. Row-Level Security policies restrict every table to `owner_id = auth.uid()` except `comments` and `views` which allow insert from public.

### Tables

```sql
brand_profiles (
  id               uuid PRIMARY KEY,
  owner_id         uuid NOT NULL REFERENCES auth.users(id),
  name             text NOT NULL,         -- "Vayu Labs", "Project Win", "Personal"
  accent_color     text NOT NULL,         -- hex like "#FF6B35"
  logo_url         text,                  -- R2 key for uploaded logo
  created_at       timestamptz DEFAULT now()
)

media_objects (                            -- polymorphic core
  id                       uuid PRIMARY KEY,
  owner_id                 uuid NOT NULL REFERENCES auth.users(id),
  type                     text NOT NULL CHECK (type IN ('video', 'audio')),
  slug                     text NOT NULL UNIQUE,   -- 10-char nanoid
  title                    text,                    -- AI-generated, editable
  description              text,
  status                   text NOT NULL CHECK (status IN (
                             'uploading', 'transcribing', 'processing',
                             'ready', 'failed'
                           )),
  brand_profile_id         uuid REFERENCES brand_profiles(id),
  duration_seconds         numeric,
  r2_composite_key         text,           -- {id}/composite.webm
  r2_screen_key            text,           -- {id}/raw/screen.webm
  r2_camera_key            text,           -- {id}/raw/camera.webm
  r2_mic_key               text,           -- {id}/raw/mic.webm
  r2_systemaudio_key       text,           -- optional
  composite_thumbnail_key  text,           -- {id}/thumbnail.jpg
  trim_start_sec           numeric,        -- nullable
  trim_end_sec             numeric,        -- nullable
  password_hash            text,           -- nullable (bcrypt)
  created_at               timestamptz DEFAULT now(),
  updated_at               timestamptz DEFAULT now(),
  deleted_at               timestamptz
)

transcripts (
  id                    uuid PRIMARY KEY,
  media_object_id       uuid NOT NULL REFERENCES media_objects(id) ON DELETE CASCADE,
  deepgram_request_id   text,
  language              text DEFAULT 'en',
  full_text             text NOT NULL,
  word_timestamps       jsonb NOT NULL,    -- [{word, start, end, confidence}]
  created_at            timestamptz DEFAULT now()
)

ai_outputs (
  id                    uuid PRIMARY KEY,
  media_object_id       uuid NOT NULL REFERENCES media_objects(id) ON DELETE CASCADE,
  title_suggested       text,
  summary               text,
  chapters              jsonb,             -- [{start_sec, title}]
  action_items          jsonb,             -- [{text, timestamp_sec}]
  llm_model             text NOT NULL,
  generated_at          timestamptz DEFAULT now()
)

views (
  id                    uuid PRIMARY KEY,
  media_object_id       uuid NOT NULL REFERENCES media_objects(id) ON DELETE CASCADE,
  viewer_ip_hash        text NOT NULL,     -- SHA-256(ip + server_salt)
  viewer_country        text,              -- CF headers
  watched_seconds       numeric DEFAULT 0,
  max_watched_sec       numeric DEFAULT 0,
  user_agent_summary    text,              -- "Chrome/macOS", etc.
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now()
)

comments (
  id                    uuid PRIMARY KEY,
  media_object_id       uuid NOT NULL REFERENCES media_objects(id) ON DELETE CASCADE,
  commenter_name        text NOT NULL,
  commenter_email       text NOT NULL,
  timestamp_sec         numeric NOT NULL,
  body                  text NOT NULL,
  read_by_creator_at    timestamptz,
  created_at            timestamptz DEFAULT now()
)
```

`pg-boss` manages its own `pgboss.*` schema for job queueing.

### Key design choices

- **`media_objects.type` is the polymorphic hinge.** Audio recordings (future Granola-alt) set `type='audio'`, leave `r2_camera_key` / `composite_thumbnail_key` null, and reuse the same transcript/ai_outputs/comments/brand_profiles tables.
- **Trim is stored, not applied.** `trim_start_sec` / `trim_end_sec` are player-side clamps; no re-encoding. Raw track downloads remain untrimmed.
- **Brand profile lives on the media_object.** Same recording can be re-branded by updating the foreign key; no data duplication.
- **Views are raw rows, drop-off is a query.** A simple aggregation over `max_watched_sec` buckets renders the drop-off chart on demand. No materialized views.
- **Slugs use nanoid (10 chars, URL-safe alphabet).** Collision probability is negligible at expected volumes; not sequentially guessable.

---

## Recording Flow (Client-Side)

### Browser APIs

- `getDisplayMedia({ video: {width: 3840, height: 2160}, audio: true })` — screen + system audio (Chrome-only for the audio part; acceptable Stage 1 constraint).
- `getUserMedia({ video: {width: 1920, height: 1080}, audio: true })` — camera + mic.
- `OffscreenCanvas` + `requestAnimationFrame` — compositing surface; draws screen feed at 30fps, masks and overlays camera bubble.
- `MediaRecorder` instances × 4 (or 5 if system audio enabled) in parallel:
  - Composite video (VP9 + Opus, output to R2 composite key)
  - Raw screen (no camera overlay)
  - Raw camera
  - Raw mic audio
  - Raw system audio (optional)
- `@aws-sdk/lib-storage` `Upload` class — S3-compatible multipart upload streaming chunks to R2 **during** recording.

### UI flow

1. **`/` Home** — list of past recordings, "New recording" primary action.
2. **Pre-record modal:**
   - Resolution: 1080p / 1440p / 4K (4K shows a "may stress CPU" note)
   - Camera: off / on
   - Bubble shape: circle / rounded square / rectangle / hexagon
   - Bubble size: small / medium / large (preview in mock viewport)
   - Bubble position: draggable; snap to corners available
   - System audio: on/off
   - Brand profile: dropdown (Vayu Labs / Project Win / Personal / None)
3. **Start** — permission prompts → 3s countdown → recording begins; media_object row created with `status='uploading'`.
4. **Recording view** — minimal HUD (elapsed time, pulsing dot, stop/pause); HUD is a separate DOM element, not drawn into canvas, so it doesn't appear in the output.
5. **Stop** — finalize MediaRecorders, wait for tail chunks to upload, POST `/api/recordings/:id/complete` with metadata, redirect to `/v/:slug`.

### Technical decisions

- **Container format: WebM (VP9 + Opus).** Native browser output; zero transcoding; universally playable in target browsers.
- **Composite at 30fps.** 60fps doubles encoder load for negligible perceived improvement.
- **Upload during recording.** MediaRecorder's `ondataavailable` fires every 5 seconds; chunks stream to R2 multipart upload. On stop, only the final ~5s remains to upload. This is the mechanism that makes "stop → link ready" feel instant.
- **Bubble baked into composite at record time.** Matches scope choice E2 (no re-export editing). Raw camera track preserved separately for NLE workflows.
- **Parallel MediaRecorders for raw tracks.** Memory/CPU cost ~1.5× vs composite-only; acceptable on M4 Pro + 48GB RAM. Validated early in implementation (see Testing).

### 4K stress contingency

If Chrome drops frames during stress testing, fallback tiers in order:
1. Composite at 4K, raw screen at 1440p, others unchanged.
2. Composite at 1440p, raw tracks unchanged.
3. Composite at 1080p, raw tracks unchanged.

Telemetry: MediaRecorder's `dropped_frames` metric logged to console + (future) client-side error reporter.

---

## Backend Pipeline

### Orchestration

```
[Client] Multipart upload to R2 finalizes
  ↓
POST /api/recordings/:id/complete
  ↓
Set media_objects.status = 'transcribing'
Enqueue (pg-boss):
  - generate_thumbnail
  - start_transcription (calls Deepgram w/ callback URL)
  ↓
[Deepgram] POSTs to /api/webhooks/deepgram
  ↓
Verify signature, save transcripts row
Enqueue in parallel (pg-boss):
  - generate_title_summary
  - generate_chapters
  - extract_action_items
  ↓
All three complete → set status = 'ready'
```

### Deepgram integration

- Nova model, English default (detectable if ever multi-language).
- Called with `callback` URL param; avoids polling.
- Input: R2 presigned URL for the composite. R2 egress is free, so Deepgram can pull any file size.
- Composite already contains mic + system audio mixed via Web Audio API at record time — Deepgram sees exactly what the viewer hears.

### LLM jobs (Claude Sonnet 4.6 via Vercel AI SDK)

- **title + summary:** transcript → `{title: string, summary: string}` structured output. ~$0.003 per call.
- **chapters:** transcript with word timestamps → `[{start_sec, title}]`. Prompt explicitly allows empty array for short/single-topic recordings. ~$0.002.
- **action_items:** transcript → `[{text, timestamp_sec}]`. Prompt allows empty array. ~$0.002.
- **Provider abstraction:** Vercel AI SDK lets us swap to GPT-4o-mini or Gemini 2.0 Flash via env var `LLM_PROVIDER` + `LLM_MODEL_ID`. Gemini 2.0 Flash would cost ~1/40th of Claude; acceptable quality for these tasks once we have baseline data.
- **Total per-recording LLM cost:** ~$0.007 on Claude Sonnet 4.6.

### Thumbnail generation

Worker pulls composite from R2 → `ffmpeg-static` extracts frame at 1s mark (or `trim_start_sec + 1` if trim is set) → JPG uploaded to R2 as `{id}/thumbnail.jpg`. ~2 seconds of work per recording.

### Retry semantics

- `pg-boss` exponential backoff: 15s → 1m → 5m, max 3 retries.
- Exhausted retries: job archived, media_object status flips to `ready` anyway (recording is still watchable without its AI extras). Failed-piece indicator on the recording card with "Retry AI" button for manual re-kick.

### Observability (Stage 1, minimal)

- Structured JSON logs to stdout; Coolify captures container logs.
- No Sentry / Loki / Grafana initially. Revisit if pain emerges.

---

## Viewer / Share Page

### URL

`loom.dissonance.cloud/v/:slug`

### Layout

```
┌─────────────────────────────────────────────────┐
│  [Brand logo]                    [Copy link] [⋯] │
├─────────────────────────────────────────────────┤
│                                                  │
│              [   Video player (Plyr)   ]         │
│                                                  │
│  ▶ ━━━●━━━━━━━━━━━━━━━━━━━━ 3:42 / 8:15         │
│                                                  │
├─────────────────────────────────────────────────┤
│  Title (AI-generated, editable by creator)       │
│  2–3 sentence summary                            │
├─────────────┬───────────────────────────────────┤
│  Transcript │  Comments (2)                     │
│  [0:03] …   │  [@0:42] Kate: …                  │
│  [0:08] …   │  [@1:15] Alex: …                  │
│             │  [+ Add comment at 3:42]          │
└─────────────┴───────────────────────────────────┘
```

### Player (Plyr + custom chapter plugin)

- Chapter markers rendered on seek bar from `ai_outputs.chapters`.
- Trim clamps: player enforces `currentTime` within `[trim_start_sec, trim_end_sec]` if set; scrubber displays only the trimmed window.
- Accent color applied via `--brand-accent` CSS custom property → progress bar + control hover states.
- Transcript auto-scrolls with playback; clicking a word seeks to that timestamp.

### Video delivery + security

- **R2 bucket is private.** Viewer load path: server generates a 1-hour signed R2 URL and passes it to the client as the `<video>` source.
- **Password-protected videos** actually work because direct R2 URL is not public. Flow:
  1. GET `/v/:slug` detects `password_hash IS NOT NULL` → renders password form.
  2. POST `/v/:slug/unlock` with password → bcrypt verify → signed cookie scoped to slug (24h).
  3. Subsequent GET with cookie → renders player and issues signed R2 URL.
- **URL expiry mid-playback:** client detects 403 on segment/range request → calls `/api/v/:slug/refresh-url` → sets new src, resumes at saved `currentTime`.

### Comments (V4)

- Anonymous submission: name + email required, no account needed.
- Attached to current playhead timestamp.
- Rate limit: per-IP, 3 comments / 5 minutes; hCaptcha on 4th within window.
- Server sends transactional email to creator via Resend on new comment.
- Displayed as pins on seek bar + threaded list below video.

### View tracking (V2)

- On first `play`: POST `/api/v/:slug/view` with IP-hashed visitor ID.
- On progress: client sends updates every 5s via `navigator.sendBeacon`.
- Drop-off chart on creator side: SELECT aggregating `max_watched_sec` into 10 buckets over recording duration.

### Brand profile application (Layer 1 only)

- `accent_color` → `--brand-accent` CSS variable.
- `logo_url` → `<img>` in share page header.
- No font changes, no full-page theming, no custom CTAs. Those are Layer 2+ for a future spec.

---

## Creator Dashboard & Editing

### Dashboard (`/`)

- Grid of recording cards: thumbnail, title, duration, status chip, brand badge, view count.
- Filters: by brand profile, by status, by search (Postgres full-text on `transcripts.full_text`).
- Sort: created_at desc (default), views desc.
- Click card → `/v/:slug` with creator "Edit" toolbar visible (hidden for anonymous viewers).

### Trim editing (E2)

On `/v/:slug` when authenticated, "Edit" toggles a trim UI:

```
┌────────────────────────────────────────────────────┐
│  ■━━━━━━●━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━●━━■   │
│    start handle                   end handle      │
│    0:03                                    7:52   │
│  Original: 0:00 – 8:15                            │
│  Trimmed:  0:03 – 7:52   [Save] [Reset] [Cancel]  │
└────────────────────────────────────────────────────┘
```

- Save writes `trim_start_sec` / `trim_end_sec`; no video re-encoding.
- Composite download is always full-length. Raw tracks are always full-length. Only the player applies trim.
- Trim-respecting downloads deferred to a later spec (on-demand ffmpeg job if ever needed).

### Other creator-only actions

- Edit title (overrides AI-suggested title).
- Delete recording (soft delete: `deleted_at`, lifecycle rule cleans R2 after 30 days).
- Change brand profile.
- Toggle password protection (sets/clears `password_hash`).
- Download raw tracks as ZIP (server endpoint streams multiple R2 objects into a zip).
- Retry failed AI outputs.

---

## Testing Strategy

Scaled to a solo tool, not enterprise.

- **Vitest unit tests** — business logic only: slug generation/collision, trim validation, password verification, access control, R2 key construction. ~20–30 tests.
- **Integration tests** — API routes that matter: upload init/complete, Deepgram webhook signature verification, password unlock, view recording, comment posting. ~10–15 tests.
- **Playwright E2E** — one golden path: record 10s video → assert media_object goes `uploading → transcribing → processing → ready` within 60s, transcript populated, title generated. Runs on merge to `main`.
- **Deliberately not tested:**
  - MediaRecorder capture pipeline (browser-API-heavy, flaky in CI — manual smoke test instead)
  - AI output quality (manual eyeballing)
  - Full UI regression (solo creator; real-use reveals breakage)

### Implementation milestone 0 (pre-MVP smoke test)

Verify "4K composite + 4K raw screen + 1080p raw camera + mic + system audio" sustains 10 minutes without Chrome dropping frames on Mac mini M4 Pro. If this fails, engage the 4K contingency tiers before building more features.

---

## Deployment & Operations

### Container

- Multi-stage Dockerfile, base `node:22-alpine`.
- Doppler CLI installed in final stage.
- `ENTRYPOINT ["doppler", "run", "--"]`, `CMD ["node", "server.js"]`.
- Database migrations run by a `migrate.ts` script before `server.js` boots.
- `ffmpeg-static` npm package (no system dependency).
- Listens on port 3000.

### Coolify

- GitHub app connector → private repo → Dockerfile at root → auto-deploy on push to `main`.
- Domain: `loom.dissonance.cloud` (existing wildcard DNS for `*.dissonance.cloud`).
- One env var: `DOPPLER_TOKEN` (project-scoped service token).
- Traefik handles TLS + routing.
- Post-deploy verification: immediately SSH + `docker inspect` the container labels per the VPS SOP in Cap.so deployment learnings.

### External accounts / services

- **Supabase** — new project dedicated to this app. Not co-tenanted with Athena.
- **Cloudflare R2** — new bucket `loom-media`, private. Purge of soft-deleted recordings handled by a daily scheduled `pg-boss` job that lists `media_objects` with `deleted_at < now() - 30d` and issues `DeleteObject` calls for each R2 key before hard-deleting the DB row. (R2 lifecycle rules can't read Postgres state; doing this in app code keeps logic in one place.)
- **Deepgram** — existing account; new API key scoped to this project.
- **Anthropic** — API credits purchased separately from Claude Max plan (Max covers only Claude.ai + Claude Code, not API usage).
- **Resend** — account set up, `dissonance.cloud` domain verified, `loom-notifications@dissonance.cloud` as from address.
- **Doppler** — new project `loom-clone`, all runtime secrets migrated in.

### Secrets managed by Doppler

- `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_ENDPOINT`
- `DEEPGRAM_API_KEY`, `DEEPGRAM_WEBHOOK_SIGNING_SECRET`
- `ANTHROPIC_API_KEY`
- `RESEND_API_KEY`
- `LLM_PROVIDER` (default `anthropic`), `LLM_MODEL_ID` (default `claude-sonnet-4-6`)
- `SESSION_SECRET`, `VIEW_HASH_SALT`
- `NEXT_PUBLIC_APP_URL` (`https://loom.dissonance.cloud`)

---

## Scope Fence (Stage 1 Boundary)

**Explicitly NOT in this spec** — each is deferred to its own future spec:

- macOS menubar app (Swift + ScreenCaptureKit). Upload API designed to accommodate it; menubar app will hit the same endpoints.
- iOS app (ReplayKit / Broadcast Upload Extension).
- Multi-tenant / team invites / workspace concept.
- Brand profile Layers 2–5 (full theming, custom CTAs, custom domains per brand, branded recorder UI).
- Full in-browser editor (blur, middle-cuts, drawing, text overlays).
- AI Q&A chat interface on a recording.
- Emoji reactions on videos.
- Outbound webhooks for automations.
- Granola-alt / audio-based capture. Backend `media_objects` schema supports `type='audio'` already; capture flow is a separate spec.

---

## Future Stages (Reference Only)

- **Brand profile Layer 2 (near-term follow-up).** User has already signaled intent to add full page theming (background, fonts, layout) after Stage 1 proves out. Expected to be a small spec on top of the existing `brand_profiles` table (added columns: `theme_background`, `theme_font_family`, etc.).
- **Stage 2 — macOS menubar app.** Swift + ScreenCaptureKit recorder with global hotkeys, same backend APIs. ~3-4 weeks. Expected when Chrome-based recorder's papercuts (browser-only, no global hotkey, Chrome-only for system audio) become meaningful friction.
- **Stage 3 — iOS app.** ReplayKit-based recording. Separate capture pipeline, same backend. Timing TBD; probably 6+ months out.
- **Future — Granola-alt (audio-first).** Reuses `media_objects`, transcripts, ai_outputs, brand_profiles. New capture flow (meeting bot or system audio tap). New viewer UX (transcript-centric, not video-centric). Separate spec.

---

## Known Risks & Open Questions

### Risks

1. **4K parallel MediaRecorder throughput on Chrome.** Four concurrent VP9 encodes (plus a 1080p camera encode) may overload Chrome's pipeline even on M4 Pro. Mitigated by milestone 0 smoke test + contingency tiers; if all tiers fail, raw stream exports may need to be lowered to a subset of tracks.
2. **Chrome-only for system-audio capture.** Acceptable for Stage 1 (creator uses Chrome); becomes a real limitation if Stage 2 brings in non-Chrome users or if the user ever needs Safari/Firefox recording.
3. **R2 signed URL expiry mid-playback.** Handled via client-side refresh endpoint, but an edge case to watch — a 2-hour video paused mid-playback could hit 403 on resume.
4. **No adaptive bitrate.** Mobile-on-cellular viewers will have a poor experience on 4K recordings. Mitigation: flag this in the UI if we detect a mobile user agent; suggest they use wifi. Not blocking for Stage 1.
5. **WebM playback on older iOS Safari** (< v16). If viewers on older iPhones show up, we may need a server-side MP4 transcode path. Not building until observed.
6. **Coolify label auto-generation bug** (per Cap.so deployment learnings). First deploy requires manual verification via `docker inspect`.

### Open questions

- **Repo name / app name.** Directory is currently `Loom_Clone`. A real name should be chosen before public share links exist (embed in branding, OG tags, etc.). Not blocking design.
- **Dashboard empty state / onboarding.** First-time UX when user has zero recordings — skip entirely for a solo tool, or add a simple "Record your first video" CTA? Leaning skip; creator doesn't need onboarding.
- **Brand profile logo upload.** Stored in R2 (same bucket, `/brand-logos/{brand_id}.{ext}`) or Supabase Storage? Leaning R2 for consistency; flag if Supabase Storage's image CDN becomes attractive.
- **Retention policy.** Does the creator want automatic archive/delete after N days for old recordings? Not in Stage 1; revisit after use.
