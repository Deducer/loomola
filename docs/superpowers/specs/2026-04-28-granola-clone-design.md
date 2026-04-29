# Granola-alt — Design Spec (MVP)

**Date:** 2026-04-28
**Status:** Draft, pending review
**Owner:** Ian Cross
**Working name:** Granola-alt (final product name to be picked at launch)

## TL;DR

A self-hosted, Granola-faithful AI meeting note-taker built **as a third surface on top of the existing Loom_Clone backend**, not a separate stack. Audio meetings flow through the same `media_objects` polymorphic schema, the same R2 storage, the same Deepgram → Claude → pg-boss pipeline that already powers the Loom side. Capture is desktop-only (macOS, extending the existing `desktop/` Swift app); the web app at `loom.dissonance.cloud` is the unified browse/manage surface for both audio and video.

The MVP is "Granola, faithfully" plus three differentiator hooks designed to compound over time:
- **Shared word dictionary** (used by both audio and video transcripts).
- **Speaker labeling MVP** with `people` table — manual rename today, auto-recognition follow-up has the data structure ready.
- **Embedding-on-write** to pgvector — passive corpus accumulation so the future cross-meeting AI Q&A surface has a year of indexed data when it ships.

Obsidian sync is per-project (reusing `brand_profiles` as the project concept), manual-trigger from `/notes/:id`, one-way (app → Obsidian). NotebookLM is treated as a temporary AI Q&A surface via clean `.md` exports until the in-app chat is built.

The MVP scopes to roughly three weeks of focused work. Eight follow-up specs are listed and explicitly out-of-MVP.

---

## Why merge with Loom_Clone (decision rationale)

The Loom_Clone CLAUDE.md already states: *"Designed as a polymorphic media platform so future audio-based products (Granola-alt, MacWhisper-alt) share the backend."* This spec ratifies that choice rather than re-deciding it. The architectural reasons:

1. **`media_objects.type` is already `'video' | 'audio'`.** Audio is a first-class type in the schema. No new core entity needed.
2. **The processing pipeline is provider-shaped, not media-shaped.** The existing `transcribe` job calls Deepgram with an audio source — it doesn't know or care whether that audio came from a video composite or an audio-only meeting. Same for `title_summary`, `chapters`, `action_items` — they read transcripts, not video.
3. **Folders, search (FTS), brand_profiles, comments, sharing, view tracking, password protection** are all polymorphic-by-construction. Audio gets these for free.
4. **Doppler secrets, Coolify deploys, Mailgun, Supabase Auth, R2 multipart upload** are infrastructure already paid-for.

The merge model chosen is **A: fully unified dashboard** (Q1). Cards on `/` show audio "notes" and video recordings side by side, distinguishable by a small type chip. Detail pages remain type-specific (`/recordings/:id/edit` for video, new `/notes/:id` for audio) — the dashboard dispatches by `media_objects.type`.

A separate stack (e.g., a new `granola.dissonance.cloud` deployment with its own DB) would re-pay every infra bill above and lose the cross-product corpus benefit (search across audio + video transcripts, dictionary shared across products, embeddings unified).

---

## Goals and non-goals

### Goals

- Capture meeting audio reliably from Zoom, Google Meet, and Microsoft Teams without joining as a bot and without triggering on non-meeting microphone activity.
- Two-pane note-taking surface during the meeting (your notes left, transcript right post-meeting).
- AI-generated summary that **incorporates your raw notes** as the spine, with the transcript filling in around them.
- Speaker labeling that scales: manual rename for MVP, with the schema and data shape that make voice-print auto-recognition cheap to add later.
- Easy file access — clean markdown export with YAML frontmatter, one-click Obsidian sync per project, downloadable audio + transcript.
- LLM-friendly corpus: pgvector embeddings on transcripts and summaries, accumulating from day one.
- Provider portability: transcription, LLM, and embedding layers are each swappable adapters.
- Long-term durability: schema designed for multiple-hour meetings every week for years.

### Non-goals (explicit, MVP)

- Browser-based mic capture (cut from MVP per Q2 follow-up; trivially addable later).
- Live transcript during the meeting (post-meeting only in MVP; live is a follow-up spec, the schema and Realtime publication are designed-for).
- Voice-print speaker auto-recognition (manual labeling MVP; ML follow-up).
- Calendar integration (manual attendee picker in MVP; Apple EventKit / Google Calendar follow-up).
- AI Q&A chat against meetings or the cross-meeting corpus (NotebookLM via .md export is the interim).
- Per-meeting-type prompt templates / automation pipeline (one default prompt per media type in MVP).
- Periodic screenshots (Shadow-style).
- Obsidian context-file referencing (pulling related vault notes into the AI summary).
- Bidirectional Obsidian sync.
- Multi-tenant / team sharing for meetings (single-user, like the rest of Loom Stage 1).
- Mobile / Apple Watch capture.

---

## MVP scope

### Eight feature areas

1. **Desktop app extension** (`desktop/`) — meeting detection (Zoom/Meet/Teams), audio capture (system + mic), upload to existing R2 endpoints, pre-meeting picker (project + attendees), Obsidian sync writer.
2. **Two-pane notes page** at `/notes/:id` — markdown editor (left), transcript + AI summary (right), audio playback, speaker labeling UI.
3. **Unified dashboard** — type chip on cards, type filter, audio waveform thumbnails.
4. **Speaker labeling** — `people` table, per-recording rename, candidate set bounded by pre-meeting attendees.
5. **Shared word dictionary** — `dictionary_terms` table, fed to Deepgram on every transcribe (audio + video both benefit).
6. **pgvector embedding-on-write** — `transcript_chunks` + `summary_embeddings`, no retrieval UI yet; corpus accumulation for future RAG.
7. **Streaming AI summary UX** — Granola-style "generating notes" bar, real Claude streaming via Vercel AI SDK + Supabase Realtime publication on `ai_outputs`.
8. **Per-project Obsidian sync** — manual-trigger from `/notes/:id`, vault path resolved via three-level fallback (per-meeting override → brand_profile path → global default).

### Rough effort estimate

~3 weeks of focused work, broken roughly:

- Week 1: schema migrations, capture flow (desktop + backend ingest), processing pipeline extensions, dictionary infra.
- Week 2: `/notes/:id` two-pane UI, speaker labeling UI, dashboard unification, streaming summary infrastructure (Realtime publication + Tiptap + bar UX).
- Week 3: Obsidian sync (desktop writer + path resolution), export endpoints, pre-meeting picker, end-to-end smoke testing, polish.

This is an estimate, not a commitment. Brainstorming → spec → plan → execute via subagents is the working pattern; the plan phase will surface any milestones that need to be split.

---

## System architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                       User's Mac                                │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Desktop app (Swift, extending existing desktop/)        │   │
│  │  - NSWorkspace meeting detection (Zoom/Meet/Teams)       │   │
│  │  - ScreenCaptureKit + AVFoundation audio capture         │   │
│  │  - R2 multipart upload (signed-URL-per-part)             │   │
│  │  - Pre-meeting picker (project + attendees)              │   │
│  │  - Supabase Realtime subscriber (Obsidian sync events)   │   │
│  │  - Obsidian writer (filesystem)                          │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Browser                                                 │   │
│  │  - Chrome extension (existing) + new content script for  │   │
│  │    meet.google.com / teams.microsoft.com / zoom.us/wc/   │   │
│  │  - Web app at loom.dissonance.cloud                      │   │
│  │    - / dashboard (audio + video unified)                 │   │
│  │    - /notes/:id two-pane editor                          │   │
│  │    - /recordings/:id/edit (Loom unchanged)               │   │
│  │    - /brands (gets meetingNotesVaultPath field)          │   │
│  │    - /people, /dictionary settings                       │   │
│  └──────────────────────────────────────────────────────────┘   │
└────────────────────────────────┬────────────────────────────────┘
                                 │  HTTPS
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                   loom.dissonance.cloud (VPS)                   │
│  Next.js 15 + React 19 + Tailwind 4                             │
│  Drizzle ORM → Supabase Postgres (with pgvector)                │
│  pg-boss queues (existing 6 + 3 new):                           │
│    transcribe, title_summary, chapters, action_items,           │
│    thumbnail, preview_sprite,                                   │
│    audio_waveform (NEW), embed_transcript (NEW),                │
│    embed_summary (NEW), obsidian_sync (NEW)                     │
│  Supabase Realtime publication on ai_outputs + obsidian_events  │
└────────────────────────────────┬────────────────────────────────┘
                                 │
        ┌────────────────────────┼────────────────────────┐
        ▼                        ▼                        ▼
┌──────────────┐         ┌──────────────┐         ┌──────────────┐
│ Cloudflare   │         │   Deepgram   │         │   OpenRouter │
│      R2      │         │ (transcribe) │         │   (Claude /  │
│ (audio+video)│         │              │         │   summary)   │
└──────────────┘         └──────────────┘         └──────────────┘
                                                  ┌──────────────┐
                                                  │    OpenAI    │
                                                  │  (embed-3-   │
                                                  │   small)     │
                                                  └──────────────┘
```

### What's new in the architecture

- **Three new pg-boss queues**: `audio_waveform`, `embed_transcript`, `embed_summary`, `obsidian_sync`. Lazy-init follows the existing pattern in `getBoss()`.
- **First Supabase Realtime use** in the project. Two publications: `ai_outputs` (for streaming summary token-level updates to `/notes/:id`) and a per-user `obsidian_events` channel (for the desktop app to receive sync triggers). Realtime is part of the standard Supabase setup; turning on a publication is a single SQL line.
- **Three new third-party providers** behind adapters: OpenAI (embeddings), OpenRouter (LLM router for summary/chapters/action_items), and pgvector (Postgres extension, not a third party but a new dependency).
- **Desktop app gains filesystem responsibilities**: writing canonical `.md` files to user-configured Obsidian vault paths.

### What stays unchanged

- The Loom side: `/record`, `/v/:slug`, `/recordings/:id/edit`, `/brands` UI all behave as today (the `/brands` page gets one new field but no UX rework).
- Auth, secrets management, Coolify deploy flow, container build.
- The 6 existing pg-boss queues for video processing.
- R2 multipart upload, signed-URL-per-part flow.
- All existing migrations, RLS policies, and FTS infrastructure.

---

## Data model

### New tables

#### `notes`

User's hand-typed notes per meeting. Markdown body, autosaved.

```ts
notes (
  id            uuid PK,
  mediaObjectId uuid FK → media_objects(id) ON DELETE CASCADE UNIQUE,
  ownerId       uuid NOT NULL,
  body          text NOT NULL DEFAULT '',
  updatedAt     timestamptz NOT NULL DEFAULT now(),
  createdAt     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX notes_media_object_idx ON notes(mediaObjectId);
```

One row per meeting. Created lazily on first edit (`POST /api/notes/:id` upsert pattern).

#### `people`

User's known meeting participants. Becomes the candidate pool for speaker labeling and the basis of future calendar/contacts integration.

```ts
people (
  id          uuid PK,
  ownerId     uuid NOT NULL,
  displayName text NOT NULL,
  email       text,
  notes       text,                  -- "voice = nasally; works at Acme"
  createdAt   timestamptz NOT NULL DEFAULT now(),
  updatedAt   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX people_owner_idx ON people(ownerId);
CREATE INDEX people_email_idx ON people(ownerId, email) WHERE email IS NOT NULL;
```

#### `speaker_assignments`

Per-recording mapping: `speaker_idx` (Deepgram diarization output) → `personId` or one-off label.

```ts
speaker_assignments (
  id                   uuid PK,
  mediaObjectId        uuid FK → media_objects(id) ON DELETE CASCADE,
  speakerIdx           integer NOT NULL,         -- Deepgram-assigned 0,1,2...
  personId             uuid FK → people(id),     -- nullable
  displayLabelOverride text,                     -- nullable; one-off name
  createdAt            timestamptz NOT NULL DEFAULT now(),
  CHECK (personId IS NOT NULL OR displayLabelOverride IS NOT NULL)
);
CREATE UNIQUE INDEX speaker_assignments_media_speaker_idx
  ON speaker_assignments(mediaObjectId, speakerIdx);
```

`displayLabelOverride` is for the case where the user just wants a label for this meeting (e.g., "Customer A") without creating a `people` row. The two-column structure supports both modes.

#### `dictionary_terms`

User's shared vocabulary. Fed to Deepgram on every transcribe call, both audio and video. Variant-collapsing post-processing applies on transcript persistence.

```ts
dictionary_terms (
  id        uuid PK,
  ownerId   uuid NOT NULL,
  term      text NOT NULL,
  variantOf uuid FK → dictionary_terms(id),    -- nullable; for "Aman" canonical, "Amaan" / "Aamaan" variants
  createdAt timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX dictionary_terms_owner_idx ON dictionary_terms(ownerId);
CREATE UNIQUE INDEX dictionary_terms_owner_term_idx ON dictionary_terms(ownerId, term);
```

#### `transcript_chunks`

Chunked transcript with pgvector embeddings. One row per ~512-token window.

```ts
transcript_chunks (
  id            uuid PK,
  mediaObjectId uuid FK → media_objects(id) ON DELETE CASCADE,
  chunkIdx      integer NOT NULL,
  text          text NOT NULL,
  startMs       integer NOT NULL,
  endMs         integer NOT NULL,
  embedding     vector(1536) NOT NULL,         -- pgvector type
  modelVersion  text NOT NULL DEFAULT 'openai/text-embedding-3-small',
  createdAt     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX transcript_chunks_media_idx ON transcript_chunks(mediaObjectId);
CREATE INDEX transcript_chunks_embedding_idx
  ON transcript_chunks USING hnsw (embedding vector_cosine_ops);
```

The HNSW index keeps cosine-similarity queries sub-100ms even with hundreds of thousands of chunks. `modelVersion` is on the row so we can re-embed with a different model later without losing old embeddings (write side-by-side, query both, decide migration policy).

#### `summary_embeddings`

One embedding per meeting's polished summary. Smaller, lighter, used for "find similar meetings" and high-level cross-corpus search.

```ts
summary_embeddings (
  id            uuid PK,
  mediaObjectId uuid FK → media_objects(id) ON DELETE CASCADE UNIQUE,
  embedding     vector(1536) NOT NULL,
  modelVersion  text NOT NULL DEFAULT 'openai/text-embedding-3-small',
  generatedAt   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX summary_embeddings_embedding_idx
  ON summary_embeddings USING hnsw (embedding vector_cosine_ops);
```

### Existing-table extensions

#### `media_objects` adds:

- `meetingDetectedApp` text — `'zoom'` | `'meet'` | `'teams'` | `null` (null for video and any audio source not associated with a known meeting app).
- `meetingStartedAtLocal` timestamptz — when the meeting actually started (vs `createdAt` which is upload time).
- `attendees` jsonb — array of `personId`s pre-selected at meeting start, the candidate set for speaker labeling and the basis of future closed-set ML matching.
- `r2MixedKey` text — R2 key for the mic + system-audio mixed mono file used for transcription and playback. Generated by the `transcribe` job on first run; nullable for video.
- `obsidianSaveRequestedAt` timestamptz — set when the user clicks Save to Obsidian; cleared (`NULL`) when sync confirms. Used by the desktop app on launch to find pending saves it missed while offline.
- `obsidianSyncedAt` timestamptz — last successful sync timestamp; `null` when never synced or pending after re-trigger.
- `brandProfileId` is **already present** (used today for theming on Loom side); this spec uses it as the project association for vault-path resolution. No schema change.

#### `transcripts` adds:

- `provider` text NOT NULL DEFAULT `'deepgram'` — which transcription provider produced this transcript.
- `providerRequestId` text — replaces `deepgramRequestId`. Migration: add new column, copy data, drop old in a follow-up migration once code is updated.

#### `ai_outputs` adds:

- `templateId` text NOT NULL DEFAULT `'default'` — placeholder for the templates follow-up. MVP writes `'default'`; the templates spec adds variants.
- `generationStatus` enum — `'pending'` | `'streaming'` | `'complete'` | `'failed'`. Default `'complete'` for existing rows (backfill on migration).

#### `brand_profiles` adds:

- `meetingNotesVaultPath` text — per-project Obsidian vault path. Editable from the existing `/brands` page. Used for the three-level fallback in Obsidian sync (per-meeting override → brand profile path → global default).

### RLS policies

All new tables follow the same RLS pattern as the existing schema: `ownerId = auth.uid()` for select/insert/update/delete. No anonymous access except where existing patterns allow it (e.g., comments on share pages — not relevant for audio in MVP).

`speaker_assignments`, `transcript_chunks`, `summary_embeddings`, `notes` join through `mediaObjectId → media_objects(ownerId)` rather than carrying their own `ownerId`. This matches the existing `transcripts` and `ai_outputs` pattern.

---

## Capture flow (desktop app)

### Detection rule

The single rule that gates auto-arming:

> **A known meeting app (by bundle ID or browser content-script signal) is running, AND its microphone is currently active.**

This is intentionally narrower than "any mic is active." It rules out:
- Voice memos, dictation, system audio recording apps.
- Mic activity by browsers that aren't actively in a meeting.
- Mic activity by Zoom etc. when the app is open but not in a call.

### Detection sources

#### Native macOS path (Zoom desktop, Microsoft Teams desktop)

A Swift watchdog runs in the desktop app:

```swift
let knownBundles = [
  "us.zoom.xos",                  // Zoom desktop client
  "com.microsoft.teams2",         // New Teams (Microsoft)
  "com.microsoft.teams",          // Legacy Teams
  // Apple FaceTime is intentionally excluded for MVP — most users
  // don't take meeting notes on FaceTime calls. Trivial to add later.
]

NSWorkspace.shared.notificationCenter
  .addObserver(forName: NSWorkspace.didLaunchApplicationNotification,
               object: nil, queue: .main) { ... }
```

When a known bundle launches, the watchdog enters a 2s polling loop checking whether that PID currently holds a CoreAudio input device (mic-active). The check uses Apple's privacy-indicator API (publicly available since macOS 14) to read the per-process mic-in-use state. On positive detection → auto-arm.

#### Browser path (Google Meet, Microsoft Teams web, Zoom web)

The existing Chrome extension gains a content script registered for:
- `https://meet.google.com/*`
- `https://teams.microsoft.com/v2/*`
- `https://*.zoom.us/wc/*`

The content script watches for an active call signal (DOM heuristics: Meet's `[data-call-state="active"]`-style markers, plus a fallback of "page has a granted mic permission AND was loaded under one of the meeting URL patterns"). On detection, it posts a message via `chrome.runtime.sendNativeMessage` (Native Messaging) to the desktop app:

```json
{
  "event": "meeting-active",
  "source": "meet",
  "tabUrl": "https://meet.google.com/abc-defg-hij",
  "ts": 1714339920000
}
```

Native messaging requires registering the desktop app as a native messaging host — a one-time `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.dissonance.granolaalt.json` file written at desktop install. Standard Chrome extension pattern, well-documented.

### Auto-arm UX (Q6 = B)

Detection trips the menubar icon to a glowing state and fires a system notification:

> **Granola-alt** — Meeting detected (Google Meet)
> [Start recording]   [Not now]

The user must click [Start recording] for capture to begin. **Recording never starts without explicit confirmation**, per the consent constraint discussed in brainstorming.

Future template-driven enhancement (out of MVP): per-meeting-type defaults like "always confirm for client calls; auto-start for solo work calls."

### Pre-meeting picker (modal on click)

When the user clicks [Start recording], a small modal appears in the desktop app:

```
What's this meeting?

Project (optional):    [Project Win              ▼]
Title (auto-detected): [Q2 review with Aman      ]
Attendees:             [+ Aman Patel] [+ Add person]

[Cancel]  [Start recording]
```

- **Project** is a dropdown of `brand_profiles` (the unified project concept). Optional — meetings without a project fall through to the global default vault path.
- **Title** is auto-suggested from the browser tab's `<title>` (extension passes it via the `meeting-active` message) or the Zoom/Teams window title (via `NSWorkspace.shared.runningApplications.localizedName`). User can edit before starting.
- **Attendees** is a multi-select against the user's `people` table with typeahead. Users can add new people inline (modal-in-modal). Future calendar integration auto-fills this from event attendees.

On click [Start recording], the desktop app `POST /api/recordings/init` with:

```json
{
  "type": "audio",
  "title": "Q2 review with Aman",
  "meetingDetectedApp": "meet",
  "meetingStartedAtLocal": "2026-04-28T15:32:00-07:00",
  "brandProfileId": "uuid-or-null",
  "attendees": ["personUuid1", "personUuid2"]
}
```

Backend creates a `media_objects` row with `status='uploading'` and returns the new ID + R2 multipart upload init payload.

### Audio capture

Two parallel capture sources, each encoded to AAC in real-time:

1. **System audio**: `SCStream` from ScreenCaptureKit with audio-only filter. Captures all system audio output — what's coming from speakers/headphones. macOS 13+ required (the existing desktop app already targets this).
2. **User microphone**: `AVCaptureSession` on the user-selected input device (existing desktop app exposes the picker).

Both streams are tee'd to two destinations:

- **Local rolling disk buffer**: 1MB chunks per track, retained until upload confirmation. Crash-recovery surface; on relaunch the desktop app finds unfinished sessions and offers to resume upload.
- **R2 multipart upload**: signed-URL-per-part flow via the existing `src/lib/r2/` helpers. Two tracks: `r2MicKey` and `r2SystemaudioKey`. No `r2CompositeKey`, `r2ScreenKey`, `r2CameraKey`, `playbackMp4Key` — those stay null for audio.

On stop, the desktop app:
1. Finalizes both R2 multipart uploads.
2. `POST /api/recordings/:id/complete` with track manifest.
3. Backend flips `media_objects.status` to `'transcribing'`.
4. Backend enqueues `audio_waveform` and `transcribe` pg-boss jobs in parallel.

### Cancellation

User can cancel mid-meeting via the menubar icon (recording → red "stop" pill). Stop-and-discard is an option in the kebab menu next to the stop button — confirms via "Discard? (audio will not be saved)".

---

## Processing pipeline

### Existing pipeline (unchanged for video, slightly extended for audio)

```
upload-complete
  └─ transcribe job (Deepgram, with dictionary keyterms)
     └─ on transcripts row written, fan out:
        ├─ title_summary    (Claude — generates title + summary)
        ├─ chapters         (Claude — for video; "topics" for audio)
        ├─ action_items     (Claude — pulls action items)
        └─ thumbnail        (ffmpeg, video only)
```

### New jobs (audio-aware)

```
upload-complete
  ├─ audio_waveform  (NEW, audio only — generates waveform PNG via ffmpeg
  │                    showwavespic, stored as compositeThumbnailKey)
  └─ transcribe (existing)
     └─ on transcripts row written, fan out:
        ├─ title_summary    (existing — but with notes-anchored prompt for audio)
        ├─ chapters         (existing — for video; for audio, generates "topics")
        ├─ action_items     (existing)
        ├─ embed_transcript (NEW — chunks transcript, embeds via OpenAI,
        │                     writes transcript_chunks rows)
        └─ thumbnail        (existing, video only — skipped for audio)

  after title_summary completes:
     └─ embed_summary (NEW — embeds the summary, writes summary_embeddings)

  No auto-trigger for obsidian_sync — fires only on user "Save to Obsidian" click.
```

### Failure handling

- **Best-effort jobs** (don't fail the meeting if they fail): `audio_waveform`, `embed_transcript`, `embed_summary`. These log errors but don't flip `media_objects.status` to `'failed'`.
- **Required jobs** (do fail the meeting if they fail): `transcribe`, `title_summary`. The user's transcript and summary are core; without them, the meeting is incomplete.
- **Retry policy**: pg-boss default (exponential backoff, up to 5 retries). Deepgram already uses a HMAC-signed webhook so retries are idempotent.

### Audio mixing for transcription

Mic + system audio are stored as two separate tracks in R2 but the **transcribe job mixes them into one mono file before sending to Deepgram**. This produces clean diarization (speakers don't get split across files arbitrarily) and matches Deepgram's input expectations.

```bash
ffmpeg -i mic.m4a -i system.m4a \
  -filter_complex "[0:a][1:a]amerge=inputs=2,pan=mono|c0=0.5*c0+0.5*c1[out]" \
  -map "[out]" mixed.m4a
```

Mixing is done in the same container that runs the existing video transcribe job (system ffmpeg already apk-installed). Output is uploaded to R2 as `r2MixedKey` (new column on `media_objects`, nullable, audio-only) and that's what's sent to Deepgram.

The mixed file is also what serves the audio playback on `/notes/:id` — so Plyr's `<audio>` element gets the mixed mono file, not separate tracks.

### Streaming summary (the bar UX)

The `title_summary` job uses Vercel AI SDK's `streamText` (instead of `generateText`). On the first token:
1. `ai_outputs.generationStatus` is set to `'streaming'`.
2. Tokens accumulate in memory.
3. Every ~200ms (debounced) or on token-rate slowdown, the job upserts the accumulated text into `ai_outputs.summary`.
4. On stream completion, `generationStatus` flips to `'complete'`.

Supabase Realtime publication on `ai_outputs`:

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE ai_outputs;
```

The `/notes/:id` page subscribes to row updates for the meeting's `ai_outputs` row:

```ts
supabase
  .channel(`ai_outputs:${mediaObjectId}`)
  .on('postgres_changes', {
    event: 'UPDATE',
    schema: 'public',
    table: 'ai_outputs',
    filter: `mediaObjectId=eq.${mediaObjectId}`
  }, (payload) => setSummary(payload.new.summary))
  .subscribe();
```

Client-side bar animation: time-based, not token-count-based. Bar fills/recedes over ~12 seconds (cap at 30s with "almost done…" subtext), 200ms ease-out fade on completion. Token-count-based animation yo-yos when models stall briefly; time-based feels right and matches Granola's behavior.

---

## UI surfaces

### Dashboard unification

Existing `/` already has folders, search, sort, brand filter. Three small additions:

1. **Type chip on cards**: small pill on each card with a waveform icon (audio) or play icon (video). 24×24 in the top-right of the card thumbnail area.
2. **Type filter** in the top filter bar (alongside brand/status filters): All / Audio / Video.
3. **Audio card art**: generated waveform PNG via `audio_waveform` pg-boss job. Stored as `media_objects.compositeThumbnailKey` (reusing the existing field, no schema change). Hover state shows duration + meeting app icon (Zoom/Meet/Teams glyph) in the corner.

**Card click is type-aware**: `media_objects.type === 'audio'` → `/notes/:id`, otherwise → `/recordings/:id/edit`. Single dispatcher in the card component.

### `/notes/:id` two-pane editor

This is the heart of the product.

#### Layout

- **Desktop** (≥768px): 60/40 horizontal split, notes left, transcript right.
- **Mobile** (<768px): single column stacked, notes on top, transcript collapsed under a "Transcript" disclosure.
- Header strip: inline-edit title, meeting date/time, detected app icon (Zoom/Meet/Teams), brand-profile picker, kebab menu (delete, export, save to Obsidian, copy share link).

#### Left pane — notes

- **Editor**: Tiptap with the markdown extension. Lightweight (vs Lexical's surface area), pastes from anywhere reasonably (Notion, Google Docs, plain text), bidirectional with markdown source.
- **Autosave**: debounced 500ms after last keystroke. Persists to `notes.body` via `PUT /api/notes/:id`. Shows a small "Saved" indicator with timestamp on success.
- **During recording state**: header shows "Recording — 12:34" with a pulsing red dot and a stop button. Notes are editable in real time. The right pane shows "Recording in progress" placeholder.
- **After recording state**: if the AI summary has generated, the left pane shows a **divider** between the user's raw notes and the AI-enhanced section. Both editable; both saved to `notes.body` as a single markdown blob with a clear separator (`---\n## AI summary\n...`). The summary section is generated from the AI output but the user can edit it without losing it on regeneration (the divider boundary is sticky).

#### Right pane — transcript + AI

Three vertical sections, top to bottom:

1. **Action items** + **Topics** (formerly "chapters" for video) — collapsed by default, click to expand. Inline checkboxes for action items.
2. **Transcript** — paragraphs (Deepgram's paragraph segmentation), each prefixed with the speaker label (a chip that is itself the rename UI; see below) and a click-to-seek timestamp. Click any word in a paragraph → audio jumps to that timestamp. Same UX as the existing Loom transcript tab.
3. **Audio playback bar** (sticky bottom of right pane) — Plyr `<audio>` variant: play/pause, scrub, speed (1.0x / 1.25x / 1.5x / 2.0x). Audio source is the mixed mono file at `r2MixedKey`, signed-URL refreshed on 403 (matches existing Loom video pattern).

#### Search-within-transcript

⌘F focuses an inline search input in the right pane. Typing highlights matches in the transcript and shows count. Up/down arrows navigate matches; click jumps audio to the match's timestamp.

#### Streaming summary placeholder + bar

When `ai_outputs.generationStatus = 'pending'` or `'streaming'`:

- A horizontal bar at the bottom of the right pane (above the audio playback bar). The bar has subtle motion to indicate "in progress" and shrinks toward zero over the time-based animation window.
- Above the bar, summary content streams in from top to bottom as tokens arrive.
- On `generationStatus = 'complete'`, the bar fades out (200ms), final summary settles into the structured Summary / Action items / Topics sections.

#### Speaker chip popover

At the top of the right pane, above the transcript, a horizontal row of speaker chips:

```
[Speaker 0 ⌄]  [Speaker 1 ⌄]  [Speaker 2 ⌄]
```

Click a chip → popover:

```
Assign Speaker 1

🔍 [type to filter people...]
   • Aman Patel       (in this meeting)
   • Sara Chen        (in this meeting)
   ─────────────────
   • Other people you know
   • + Create new person
   • + Just label "John" (this meeting only)
```

Top of the list: people pre-selected in the attendee picker (from `media_objects.attendees`). This is the bounded candidate set — the typeahead defaults to it before falling through to the broader `people` table. Once assigned, the chip displays the person's name and the transcript paragraphs under that speaker render with that name.

For the "just label 'John'" case, the entered text is written to `displayLabelOverride` instead of `personId`. No `people` row created.

### `/people` settings page

Standard CRUD: list, add, edit, delete people. Fields: `displayName`, `email` (optional), `notes` (optional). Sortable by name and recent-meeting-with.

The `notes` field is freeform but intended for things that will become useful for the future voice-print recognition spec ("voice = nasally, often interrupts; works at Acme Corp"). No structured schema for those fields in MVP.

### `/dictionary` settings page

Single-column list of terms. Each row: `term` text, optional `variantOf` dropdown (existing terms), delete button.

Bulk paste: textarea that takes one term per line, each line optionally `term, variant` for one-shot variant assignment.

On every transcribe call, the user's complete dictionary list (canonical terms only — variants are collapsed to canonicals after Deepgram returns) is passed to Deepgram via the `keyterms` parameter (Deepgram Nova-3+) or `keywords` for older models. This affects both audio meetings AND existing Loom video transcripts — single source of truth.

Variant collapsing is a post-processing step on the `transcripts` row write: walk the `wordTimestamps` array, rewrite any variant occurrence to its canonical, also rewrite `fullText`. Cheap (regex pass per word).

### `/brands` page changes

The existing `/brands` CRUD page gets one new field on the form: `meetingNotesVaultPath` (text, free-form, optional). Help text: "Where to save Obsidian notes for this project. Leave blank to use the global default. Example: `~/Vault/ProjectWin/Meeting Notes`".

No other changes to the `/brands` page.

---

## Streaming summary — the "generating notes" bar

Already covered in Processing pipeline § Streaming summary. Restating the user-visible UX here for clarity:

- After a meeting, when the user lands on `/notes/:id`, the right pane shows section headers (Action items, Topics, Transcript) with placeholder skeletons.
- A subtle horizontal bar appears at the bottom of the right pane, just above the audio playback controls.
- The bar animates: a slow leftward sweep, suggesting "work in progress." It progressively shrinks vertically as the summary fills in above.
- Summary content streams in from top to bottom — sentence by sentence as Claude generates tokens.
- When complete, the bar fades out and the summary settles into final layout.

This is **real Claude streaming via Vercel AI SDK + Supabase Realtime**, not a fake animation. See the "Streaming summary" section under Processing pipeline.

---

## Obsidian sync

### Scope

- **One-way only**: app → Obsidian.
- **Manual trigger only**: user clicks "Save to Obsidian" on `/notes/:id`. No auto-sync.
- **Idempotent**: re-clicking after speaker re-labeling overwrites the existing file in place (located via frontmatter `meeting_id` even if the user moved/renamed the file in Obsidian).

### Path resolution (three-level fallback)

Highest priority wins:

1. **Per-meeting override**: if the user alt-clicks the Save button, a path picker opens. The override applies only to this save.
2. **Brand profile path**: `media_objects.brandProfileId` → `brand_profiles.meetingNotesVaultPath`. Set per-project from `/brands`.
3. **Global default**: a single path stored in the desktop app's `UserDefaults` (e.g., `~/Vault/Meetings`).

The Save button shows the resolved path on hover/secondary text:

```
[Save to Obsidian → ~/Vault/ProjectWin/Meeting Notes/]
```

One click: write. Alt-click: open the override picker.

### Save flow

1. User clicks "Save to Obsidian" on `/notes/:id`.
2. Frontend `POST /api/notes/:id/obsidian-save` with optional override path.
3. Backend emits `obsidian-sync-requested` event on the per-user Realtime channel (`obsidian_events:<userId>`).
4. Desktop app (subscribed to that channel) receives the event, fetches the canonical `.md` from `GET /api/notes/:id/obsidian-export.md`, writes to the resolved path.
5. On successful write, desktop calls `POST /api/notes/:id/obsidian-synced` with the file path.
6. Backend updates `media_objects.obsidianSyncedAt = now()`.

If desktop is offline when the user clicks Save, the `media_objects.obsidianSaveRequestedAt` timestamp is set but no Realtime event is delivered. On next desktop launch, the desktop app queries `GET /api/notes?obsidian_pending=true` (returns rows where `obsidianSaveRequestedAt IS NOT NULL AND obsidianSyncedAt IS NULL`) and processes them in order. No separate pending table — the timestamp pair carries the state.

### File format

Single canonical `.md` per meeting:

```markdown
---
meeting_id: 8c7e2f4a-1b3d-4e5f-9a8c-7d6e5f4a3b2c
title: Q2 review with Aman
date: 2026-04-28T15:32:00-07:00
duration: 47m
detected_app: zoom
project: Project Win
attendees:
  - Ian Cross
  - Aman Patel
audio_url: https://loom.dissonance.cloud/api/r2/signed/...
notes_app_url: https://loom.dissonance.cloud/notes/8c7e2f4a-1b3d-4e5f-9a8c-7d6e5f4a3b2c
include_transcript: true
---

# Q2 review with Aman

## My notes

[user's raw markdown notes verbatim]

## AI summary

[notes-anchored polished summary]

## Action items

- [ ] Item 1
- [ ] Item 2

## Topics

- 00:00 - Opening / context
- 12:34 - Customer feedback review
- 28:00 - Roadmap implications
- 41:15 - Action items + close

## Transcript

**Ian** (00:00:12) – Hey, ready to start?
**Aman** (00:00:14) – Yep, give me a sec.
[full transcript with speaker labels]
```

The `meeting_id` is the canonical UUID for re-export idempotency. The desktop app maintains an index of `meeting_id` → file path (cached on launch by scanning the vault for files with this frontmatter pattern). On re-save, find by `meeting_id` and overwrite in place — even if the file has been moved or renamed.

The `audio_url` is a signed URL with a long expiration (24h), refreshed on each export. For permanent listening from inside Obsidian, users should configure the Loom app URL (`notes_app_url`) and click through.

### Optional: omit transcript

A global toggle in desktop app settings: **"Include raw transcript in Obsidian exports"** (default ON). When OFF, the `## Transcript` section is omitted from the `.md`. Use case: keeping Obsidian focused on summary + action items + your notes, while the searchable transcript lives in the app.

---

## Easy file access / export

Per-meeting export options on `/notes/:id` (kebab menu and a dedicated "Export" panel):

- **Download audio** — signed URL to `r2MixedKey`. Filename: `{slug}-{date}.m4a`.
- **Download transcript .txt** — plain text, no speaker prefixes.
- **Download transcript .md** — formatted with speaker labels and timestamps, matches the Obsidian transcript section.
- **Download full meeting .md** — complete file matching the Obsidian export format, including frontmatter.
- **Download AI summary .md** — just frontmatter + summary section, clean for drop-into-NotebookLM.
- **Copy to clipboard** — three buttons: full markdown / transcript text / summary text.
- **Save to Obsidian now** — same as the dedicated Save button, also accessible from the kebab menu.
- **Open in NotebookLM** — opens NotebookLM in a new tab with a help tooltip ("Drag the .md file you just downloaded into a notebook"). Real programmatic upload to NotebookLM is unavailable from Google's public API; this is a placeholder for a future deeper integration if Google ships an API.

Backend-light: signed URLs for audio, deterministic markdown rendering for everything else (no extra storage for export variants — generated on demand).

---

## Provider abstraction

Three swappable adapter layers, each with a default and a registry. Configured via env (Doppler) for MVP; per-user settings UI is a follow-up.

### Transcribe layer

Persisted on `transcripts.provider` (already added). Adapter interface:

```ts
interface TranscribeAdapter {
  transcribe(audioR2Key: string, opts: {
    keyterms: string[];   // user dictionary
    diarize: boolean;
  }): Promise<{
    fullText: string;
    words: Array<{ text: string; start: number; end: number; speaker: number }>;
    paragraphs: Array<{ text: string; start: number; end: number; speaker: number }>;
    providerRequestId: string;
    language: string;
  }>;
}
```

Default: `deepgram`. Registered: `whisper-local` (via local Whisper service running on the desktop or a backend host), `assemblyai`, `speechmatics`.

Webhook routing: each provider has its own webhook path under `/api/webhooks/<provider>/[recordingId]/[sig]`. The HMAC-signed pattern from the existing Deepgram webhook is the template.

### LLM layer (summary, chapters, action_items, topics)

Vercel AI SDK is already provider-agnostic; the abstraction is just a model + base URL configuration.

Default for MVP: **OpenRouter routing to `anthropic/claude-sonnet-4.6`**. Same quality as direct Anthropic, gives flexibility (one env var change moves to GPT-5, Gemini, or local Ollama).

Registered: direct `anthropic`, `openai`, `google`, `ollama` (local). Cost dial: switch to `openrouter:anthropic/claude-haiku-4.5` for cheap summaries on long meetings.

`ai_outputs.llmModel` already records which model produced the output, so cost analytics + provenance are intact across switches.

### Embed layer

New adapter:

```ts
interface EmbedAdapter {
  embed(texts: string[]): Promise<number[][]>;
  modelVersion: string;   // for transcript_chunks.modelVersion / summary_embeddings.modelVersion
  dimensions: number;
}
```

Default: **OpenAI `text-embedding-3-small`** (1536 dims, ~$0.02/1M tokens, well-supported by pgvector HNSW indices).

Registered: `voyage` (`voyage-3`), `cohere` (`embed-v3.0`), `local-ollama` (`nomic-embed-text`, 768 dims).

Schema accommodates dim differences via `transcript_chunks.modelVersion`. A change in default model means a new column / new index for the new dimensions, not a destructive rebuild — the old embeddings keep working until you decide to backfill.

### Why OpenRouter for LLM, direct OpenAI for embeddings?

OpenRouter's chat catalog is broad and well-supported; their embedding catalog is thinner. For LLM summary work, the user-flagged value of flexibility is real (Claude Max plan flexibility, swap to whatever model is best at the time). For embeddings, the use case is "stable, cheap, well-supported by pgvector" — direct OpenAI is the safest default. Both layers are abstracted, so this is reversible.

---

## Open questions / known unknowns

### Things the spec doesn't fully resolve

1. **Native messaging host registration** — the desktop app needs a one-time `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.dissonance.granolaalt.json` file. Plan should specify whether this is shipped with the desktop app installer or registered on first run. Recommendation: first-run registration with a permission prompt.
2. **Mic-active detection on macOS** — Apple's privacy-indicator API exposes "is mic in use" but the per-process attribution requires either a private framework or polling `lsof` on `/dev/audio*` style paths. Plan should validate the chosen approach against macOS 15 (latest stable) before committing.
3. **Token usage / cost ceiling for embeddings** — at default rates, ~10K-token transcripts cost <$0.001 each to embed. At hundreds of meetings per year this is trivial, but worth a per-user cap on embedding job throughput to prevent runaway costs from a misbehaving job.
4. **Transcript chunking strategy** — fixed 512-token windows with 64-token overlap is a sensible default but isn't validated. Plan should run a benchmark with one real meeting and confirm chunks retrieve sensibly via cosine search.
5. **Tiptap markdown round-trip fidelity** — Tiptap's markdown extension generally handles common cases but can lose obscure formatting on complex paste-from. Plan should include a small test suite covering paste from Notion, Google Docs, plain text, and the editor's own output.

### Decisions documented elsewhere (just pinning the references)

- **Polymorphic media** is enshrined in the existing `CLAUDE.md` and `media_objects.type` enum.
- **Direct pushes to main + Coolify auto-deploy** is the deploy model and applies to this work.
- **Doppler for all secrets** continues; new env vars (`OPENROUTER_API_KEY`, `OPENAI_API_KEY` for embeddings) go in Doppler `prd_loom`.

---

## Out-of-MVP follow-up specs

In recommended-build-order:

### 1. Templates / automation pipeline (~1–2 weeks)

Per-meeting-type prompt templates and post-meeting actions.

- New `templates` table: `id, ownerId, name, llmPrompt, outputStructure (jsonb), vaultPathOverride, postActions (jsonb)`.
- Pre-meeting picker gains a "Template" dropdown, defaults from project (brand_profile.defaultTemplateId).
- `title_summary` job uses the template's prompt + outputStructure.
- Post-actions: small per-template hooks (e.g., "if 1:1 with Aman, generate a follow-up email draft and copy to clipboard"). Implemented as additional pg-boss jobs that read the template's actions list.
- `ai_outputs.templateId` (already added in MVP) is the link.

### 2. Speaker auto-recognition (~2–3 weeks)

Voice-print enrollment from labeled segments + closed-set classifier using per-meeting attendees.

- Speaker embedding model: ECAPA-TDNN via `speechbrain`, or Resemblyzer. Backend Python service running in a separate container (or a small Swift on-device service).
- Per-`people` row: a `voice_print` column (vector embedding from labeled segments).
- `speaker_assignments` learns: when a user manually assigns `speaker_idx` to `personId`, the audio segments under that speaker are extracted, embedded, and the embedding is averaged into the person's voice_print.
- New job `match_speakers`: runs after `transcribe`. For each unique `speaker_idx` in the transcript, compute its voice embedding, compute cosine similarity against all `people.voice_print`s in `media_objects.attendees` (the pre-selected candidate set). Assign if similarity is above a threshold; otherwise leave for manual.
- The closed-set bound (just the meeting's attendees) makes this dramatically more accurate than open-set identification across all known people.

### 3. Calendar + Contacts integration (~3–5 days for Apple, +3–5 for Google)

- **Apple EventKit + Contacts** (macOS native, no OAuth). Desktop app reads upcoming events; when a meeting auto-arms, the matched event provides title, attendees (matched against `people` by email), organizer.
- **Google Calendar OAuth** — secondary path for users on Google Workspace. Server-side calendar polling, OAuth refresh tokens.
- The pre-meeting picker auto-fills attendees from the matched event. User can still edit before starting.

### 4. Live transcript stream (~3–5 days)

Deepgram Live websocket (or local Whisper streaming via the same provider abstraction). Transcript paragraphs land progressively in the `transcripts` row; the right pane fills in during the meeting.

Reuses the same Realtime publication pattern that MVP adds for streaming summaries (`transcripts` table publication addition is one SQL line).

### 5. AI Q&A / cross-meeting chat (~1–2 weeks)

RAG over the corpus (uses MVP's pgvector embeddings).

- Per-meeting chat: "What did Aman commit to in this meeting?" — RAG over `transcript_chunks` for that meeting.
- Cross-corpus chat: "Show me every meeting where we discussed attribution." — RAG over `transcript_chunks` across all the user's meetings, grouped by meeting.
- New chat surface: `/chat` page, with a meeting-context picker (current / all / project).

NotebookLM via .md export is the interim while this is unbuilt.

### 6. Periodic screenshots (Shadow-style) (~1 week)

New pg-boss job `screenshot_capture` fires every N seconds during recording. Desktop app captures via ScreenCaptureKit (image, not video), uploads to R2. Stored as `screenshots` table linked to media_object + timestamp.

UX: small thumbnail strip at the top of the transcript right pane, click to expand. Future: AI-generated captions per screenshot for searchability.

### 7. Obsidian context-file referencing (~1 week)

Desktop app reads from configured vault paths (e.g., a "context" subdirectory). Pulls relevant `.md` files as additional context for the AI summary based on attendees or template config.

Simplest version: per-template, "include these N files as system-prompt context."

Built once templates are in place — depends on follow-up #1.

### 8. Bidirectional Obsidian sync (multi-week, lowest priority)

File watcher on the vault path, parse frontmatter changes back into the app DB. Genuine distributed-systems problem (conflict resolution, identity tracking). Most users won't actually need it.

### 9. Browser-based mic memo flow (~1 day)

The `/notes/new` browser-side mic capture cut from MVP. Trivially addable using the existing Loom MediaRecorder code.

### 10. Apple Watch / iOS capture (multi-week)

Voice memo from anywhere, uploaded as `media_objects.type='audio'`.

### 11. Multi-tenant / team sharing for meetings (~1 week)

Share a meeting with a colleague (the way Loom recordings can be shared today). Reuses the existing `/v/:slug` share-page pattern with audio-shaped UI.

---

## Appendix A — Full MVP migration list

In rough application order:

1. `0010_pgvector_extension.sql` — `CREATE EXTENSION IF NOT EXISTS vector;`
2. `0011_granola_new_tables.sql` — creates `notes`, `people`, `speaker_assignments`, `dictionary_terms`, `transcript_chunks`, `summary_embeddings`. RLS policies for each. HNSW indices on the vector columns.
3. `0012_granola_table_extensions.sql` — adds `meetingDetectedApp`, `meetingStartedAtLocal`, `attendees`, `r2MixedKey`, `obsidianSaveRequestedAt`, `obsidianSyncedAt` to `media_objects`; `provider`, `providerRequestId` to `transcripts`; `templateId`, `generationStatus` to `ai_outputs`; `meetingNotesVaultPath` to `brand_profiles`.
4. `0013_realtime_publications.sql` — `ALTER PUBLICATION supabase_realtime ADD TABLE ai_outputs;` plus a custom publication for the per-user `obsidian_events` channel.
5. `0014_drop_deepgram_request_id.sql` — follow-up after code is updated to use `providerRequestId`. Run after `0013` is live.

## Appendix B — Environment variables (additions)

To add to Doppler `prd_loom`:

- `OPENROUTER_API_KEY` — for summary / chapters / action_items / topics jobs.
- `OPENAI_API_KEY` — for `text-embedding-3-small` (and image generation if needed in future).
- `EMBEDDING_PROVIDER` — defaults to `openai`. Override per-deployment.
- `LLM_PROVIDER` — defaults to `openrouter`. Override per-deployment.
- `LLM_MODEL` — defaults to `anthropic/claude-sonnet-4.6` via OpenRouter.
- `TRANSCRIBE_PROVIDER` — defaults to `deepgram` (existing). Override for testing local Whisper.

The existing `ANTHROPIC_API_KEY` stays for now (used as fallback if `LLM_PROVIDER=anthropic`).

## Appendix C — Decisions log (brainstorming)

- **Q1**: Merge model = **A (fully unified dashboard)**.
- **Q2**: Capture surface = **B (desktop primary + web mic fallback)** — later refined to desktop-only after Group A discussion. Web mic flow cut from MVP.
- **Q3**: MVP scope = "Granola, faithfully" + speaker labeling MVP + dictionary + pgvector embedding-on-write.
- **Q4**: Confirmed updated MVP cut.
- **Q5**: Storage = app stores transcripts (FTS + embeddings + cross-product search) + auto-syncs canonical `.md` to Obsidian via desktop app. Later refined to manual-trigger save (not auto), per-project path resolution.
- **Q6**: Auto-start UX = **B (auto-arm + one-click confirm)**. Calendar = deferred to follow-up; window-title suggestion as a 1-hour kicker.
- **Pre-meeting attendee picker** added to MVP (½–1 day) to bound the speaker recognition closed-set ML problem.
- **Streaming summary bar** = real Claude streaming via Vercel AI SDK + Supabase Realtime publication on `ai_outputs`.
- **Per-project Obsidian sync paths** = three-level fallback (per-meeting override → brand profile path → global default), reusing `brand_profiles` as the project concept.
- **NotebookLM** = via `.md` export, no programmatic integration.
- **OpenRouter** for LLM (flexibility); direct OpenAI for embeddings (broader pgvector support); `transcripts.provider` field for transcribe abstraction.
