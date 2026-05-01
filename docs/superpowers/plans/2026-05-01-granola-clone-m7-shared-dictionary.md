# Granola-alt — Milestone 7: Shared Dictionary — Implementation Plan

**Goal:** Give Ian a shared vocabulary list that improves future Deepgram transcripts for both Loom videos and Granola audio notes.

**What ships:**

- `/dictionary` settings page behind `ENABLE_GRANOLA=true`.
- Add/delete dictionary terms with optional canonical mapping.
- Bulk paste support for one term per line, optionally `variant, canonical`.
- Transcribe jobs pass canonical dictionary terms to Deepgram as Nova-2 `keywords`.
- Deepgram webhook collapses configured variants to canonical spellings in saved transcript text and word timestamps.

**Out of scope for M7:**

- Nova-3 migration and `keyterm` prompting.
- Fuzzy matching variants after transcript persistence.
- Per-brand or per-folder dictionaries.

## Tasks

- [x] Add dictionary page and manager UI.
- [x] Add dictionary nav entry under Granola flag.
- [x] Wire canonical terms into Deepgram transcription requests.
- [x] Add transcript variant-collapsing helper.
- [x] Add focused unit coverage.
- [x] Run typecheck, targeted tests, and browser smoke.

## Verification

- `/dictionary` can add and delete terms.
- Bulk paste can create canonicals and variants.
- Transcribe jobs include up to 100 canonical terms in `keywords`.
- Webhook persistence rewrites variant terms to canonical spellings.

## Commands Run

- `npm run typecheck`
- `doppler run --project dissonance-cloud --config prd_loom -- npm run test -- dictionary-queries dictionary-transcript-rewrite callback-signature`
- Authenticated Playwright smoke against `http://localhost:3000/dictionary` and `http://localhost:3000/?tab=notes`
