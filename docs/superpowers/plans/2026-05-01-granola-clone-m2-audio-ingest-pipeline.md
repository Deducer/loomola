# Granola-alt — Milestone 2: Audio Ingest Pipeline — Implementation Plan

**Goal:** Make the existing upload and processing backend accept audio-only `media_objects` without disturbing Loom video recording. M2 stops at backend ingestion: no Granola notes UI, no desktop meeting detection, no manual desktop recording trigger yet.

**What ships:**

- `/api/recordings/start` accepts `type: "audio"` only when `ENABLE_GRANOLA=true`.
- Audio starts only accept `mic` and/or `system-audio` tracks. Video starts keep the existing browser Loom behavior.
- `/api/recordings/:id/complete` completes audio multipart uploads, stores `r2MicKey` / `r2SystemaudioKey`, sets status to `transcribing`, and enqueues audio-specific jobs.
- `transcribe` can receive either a direct audio key or an audio media object that must first be mixed.
- New `mix_audio` job uses ffmpeg to combine mic + system audio into one mono `.m4a`, uploads it to R2, writes `media_objects.r2MixedKey`, then submits that mixed file to Deepgram.
- New `audio_waveform` job generates a waveform PNG from the mixed audio (or single audio source fallback) and stores it in `compositeThumbnailKey`, giving future Notes UI a visual artifact without adding a new column.
- Deepgram callback persists `provider` / `providerRequestId` and treats audio differently from video: transcript is required, but AI jobs remain user-triggered in a later milestone.

**Out of scope for M2:**

- Desktop app manual audio capture UI (M3).
- `/notes/:id` page (M4).
- Dashboard Notes tab (M5).
- Embedding jobs (G-M8).
- Streaming AI enhancement (G-M9).

## Tasks

- [x] Add request validation and audio media creation to `/api/recordings/start`.
- [x] Update upload key helpers/tests for audio track keys.
- [x] Update `/api/recordings/:id/complete` to branch on `media_objects.type`.
- [x] Add `mix_audio` queue/job and enqueue it for dual-track audio; enqueue direct transcription for single-track audio.
- [x] Update `transcribe` job payload to accept an `audioKey` and store provider request ID.
- [x] Update Deepgram webhook so video still fans out AI jobs, while audio only marks transcript-ready for now.
- [x] Add `audio_waveform` queue/job and enqueue it for audio.
- [x] Add focused unit tests for routing decisions and utility helpers.
- [x] Run targeted tests, typecheck, and smoke local queue creation.

## Verification

- Existing video start/complete requests remain compatible.
- Audio start with `ENABLE_GRANOLA=false` returns 404 or a disabled error.
- Audio start with `ENABLE_GRANOLA=true` creates `media_objects.type='audio'`.
- Completing an audio row with mic/system tracks stores raw keys and enqueues `mix_audio` + `audio_waveform`.
- Completing a single-track audio row enqueues direct transcription and waveform generation.
- `npm run typecheck` passes.
- Targeted unit tests pass.

## Completed Verification

- `npm run typecheck`
- `npm run test -- desktop-api-compat audio-artifacts`
- pg-boss startup smoke: 9 queues with `ENABLE_GRANOLA=true`, 7 Loom-only queues with `ENABLE_GRANOLA=false`.
- Production-backed direct job smoke: generated two tiny audio files, uploaded them to R2, mixed them with ffmpeg, generated a waveform PNG, verified the database artifact keys, then deleted the test row and all temporary R2 objects.
