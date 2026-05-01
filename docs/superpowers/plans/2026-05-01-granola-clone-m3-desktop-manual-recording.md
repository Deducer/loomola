# Granola-alt — Milestone 3: Desktop Manual Audio Recording — Implementation Plan

**Goal:** Extend the existing Swift desktop scaffold so Ian can manually start an audio note, capture mic and/or system audio, and upload the result through the M2 `type='audio'` backend. M3 proves the native capture-to-transcript path before meeting detection, calendar context, or the `/notes/:id` UI exists.

**What ships:**

- Desktop `BackendClient` can start `type='audio'` uploads with Granola metadata.
- Desktop UI exposes a manual "Start Audio Note" flow with title plus mic/system toggles.
- Mic audio records to local `.m4a` via AVFoundation.
- System audio records to local `.m4a` via ScreenCaptureKit audio sample buffers.
- Stop uploads the completed tracks with the existing multipart endpoints and calls `/complete`.
- Cancel aborts the backend row and deletes local temp files.
- Upload coordinator reads files in 8MB chunks instead of loading the whole recording into memory.
- Minimal smoke path confirms a created audio row reaches backend `transcribing` status; transcript arrival is handled by M2.

**Out of scope for M3:**

- Automatic meeting detection for Zoom/Meet/Teams.
- Calendar/EventKit attendee prefill.
- `/notes/:id` UI and Notes dashboard tab.
- Speaker labeling, dictionary wiring, embeddings, AI enhancement, or Obsidian sync.
- Live transcript during capture.
- Long-term crash recovery UI. M3 can write temp files under a session directory, but polished recovery is a later hardening pass.

## Implementation Tasks

- [x] Extend desktop API models with `type`, `title`, `meetingDetectedApp`, `meetingStartedAtLocal`, `attendees`, and `sourceContextHint`.
- [x] Add Swift unit tests for audio start-request JSON and response decoding.
- [x] Add a desktop "Test Audio Backend" handshake that starts `type='audio'` with mic/system tracks, then aborts.
- [x] Refactor `MultipartUploadCoordinator` to stream 8MB file chunks instead of `Data(contentsOf:)` on the full file.
- [x] Add `AudioRecordingSession` state model for selected tracks, local file URLs, start time, duration, and backend recording ID.
- [x] Add reusable `AudioAssetWriter` for AAC `.m4a` output from `CMSampleBuffer`, normalizing first sample time to zero.
- [x] Add `MicrophoneCaptureCoordinator` using `AVCaptureSession` + `AVCaptureAudioDataOutput` into `AudioAssetWriter`.
- [x] Add `SystemAudioCaptureCoordinator` using `SCStream` audio output into `AudioAssetWriter`.
- [x] Add `AudioNoteRecorder` orchestration: start backend row, start selected capture sources, stop writers, upload completed files, call complete, cleanup.
- [x] Update `RecorderViewModel` and `MainRecorderView` with manual audio controls and status/progress messages.
- [x] Add cancellation path: stop capture, call `/abort`, delete local files.
- [x] Run `swift test` in `desktop/`.
- [x] Run a local/prod backend audio handshake with `ENABLE_GRANOLA=true`.
- [x] Manual hardware smoke on Ian's Mac: record 20-30 seconds with mic + system audio, upload, confirm backend starts transcription.

## Completed Verification

- `swift test` in `desktop/` passed after the API-model, capture-foundation, upload-streaming, and `AudioNoteRecorder` orchestration slices.
- Production audio API smoke passed: authenticated bearer-token start created `type='audio'` with mic + system-audio uploads, abort succeeded, and the test row was deleted.
- Ian's manual hardware smoke produced slug `ZTrwDqeOop`; production verification showed `type='audio'`, `status='ready'`, mic + system tracks, mixed audio, waveform, and a saved Deepgram transcript.

## Design Notes

- Keep the desktop app thin. It captures and uploads; web remains the place for notes, transcripts, AI enhancement, project assignment, and eventual Obsidian sync.
- Store mic and system audio separately in R2. The server-side `mix_audio` job creates the canonical mixed `.m4a` for transcription and later playback.
- Prefer `CMSampleBuffer`-based writers for both capture sources. That keeps timing and format handling closer between AVFoundation mic capture and ScreenCaptureKit system audio capture.
- Use a session directory per recording under the user's temporary or Application Support area. Delete it after successful upload; leave it in place on upload failure so retry/recovery can be added without changing the capture path.
- Feature flag remains server-owned. The desktop app can show Granola controls in dev, but the backend is the real gate: if `ENABLE_GRANOLA=false`, audio start returns 404.

## Reference Notes From Meetily

- Their audio v2 stack splits stream management, mixing, normalization, and synchronization into distinct state objects. We should borrow the state-machine discipline, not the Rust/Tauri implementation.
- Their summary layer uses provider enum/adapters for OpenAI, Claude, Groq, Ollama, OpenRouter, and custom OpenAI-compatible endpoints. That reinforces the existing Granola spec's provider-agnostic adapter direction for later AI work, but M3 should not add AI provider code.
