# Granola-alt — Milestone 6: Speaker Labeling MVP — Implementation Plan

**Goal:** Let Ian maintain a people list and label Deepgram diarized speaker indexes on `/notes/:id`.

**What ships:**

- Deepgram transcription requests include diarization for new recordings.
- Stored word timestamps preserve Deepgram `speaker` indexes.
- `/people` settings page behind `ENABLE_GRANOLA=true`.
- Floating transcript card displays speaker captions when speaker indexes exist.
- Clicking a speaker caption lets the user assign an existing person or one-off label.
- Assignments persist through the existing speaker assignment API and update the transcript immediately.

**Out of scope for M6:**

- Automatic voice-print speaker recognition.
- Attendee picker inside the desktop app.
- Speaker assignment from non-diarized legacy transcripts.
- Calendar/contact import.

## Tasks

- [x] Enable Deepgram diarization and persist speaker indexes.
- [x] Add `/people` settings UI.
- [x] Resolve people + assignments into `/notes/:id`.
- [x] Add speaker captions and assignment popover to the transcript card.
- [x] Add focused unit coverage.
- [x] Run typecheck, targeted tests, and browser smoke.

## Verification

- New audio transcripts store `speaker` on word timestamps when Deepgram returns it.
- `/people` can create, edit, and delete people.
- `/notes/:id` transcript labels speakers when `speaker` indexes exist.
- Assigning a label writes `speaker_assignments` and re-renders labels without reload.

## Commands Run

- `npm run typecheck`
- `doppler run --project dissonance-cloud --config prd_loom -- npm run test -- viewer-paragraphs people-queries speaker-assignments`
- Authenticated Playwright smoke against `http://localhost:3000/people` and `http://localhost:3000/notes/ZTrwDqeOop`
