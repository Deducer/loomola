# Granola-alt — Milestone 4: Notes Page — Implementation Plan

**Goal:** Add the first usable Granola web surface: an auth-gated `/notes/:id` page for audio `media_objects`, backed by the M1 notes API and the M2/M3 audio artifacts.

**What ships:**

- `/notes/:id` route gated by `ENABLE_GRANOLA=true`.
- `:id` accepts either the audio media UUID or its slug, so desktop-created slug `ZTrwDqeOop` opens directly.
- Single-column note layout with title, metadata pills, markdown-style notes textarea, autosave, audio playback, waveform image, and transcript card.
- Audio player uses the server-mixed `.m4a` from `media_objects.r2MixedKey`.
- Waveform uses `media_objects.compositeThumbnailKey`.
- Transcript renders saved Deepgram text/word timestamps and supports click-to-seek when timestamps exist.

**Out of scope for M4:**

- Dashboard `Recordings | Notes` tabs (G-M5).
- AI enhancement and Original/Enhanced toggle (G-M9).
- Speaker labeling popovers (G-M6).
- People/dictionary settings UI.
- Obsidian/export/share menus.

## Tasks

- [x] Add query helper for owned audio note page data by UUID or slug.
- [x] Add `/notes/[id]/page.tsx` server route with feature flag and auth gate.
- [x] Add a client notes surface for title editing, notes autosave, audio playback, waveform, and transcript card.
- [x] Add focused unit coverage for slug/UUID identifier classification.
- [x] Run typecheck and targeted tests.
- [x] Verify `/notes/ZTrwDqeOop` locally or against production after deploy.

## Verification

- `ENABLE_GRANOLA=false` returns 404 by route gate.
- Non-owner audio note returns 404 by owner-scoped query.
- Video slugs do not render in `/notes/:id` by `type='audio'` query constraint.
- `/notes/ZTrwDqeOop` renders the mixed audio, waveform, transcript, and editable notes body in local authenticated browser smoke.

## Commands Run

- `npm run typecheck`
- `doppler run --project dissonance-cloud --config prd_loom -- npm run test -- notes-queries note-identifiers`
- Authenticated Playwright smoke against `http://localhost:3000/notes/ZTrwDqeOop`
