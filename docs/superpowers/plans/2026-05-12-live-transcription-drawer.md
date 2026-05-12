# Live Transcription Drawer — Implementation Plan

**Date:** 2026-05-12
**Status:** Planned, not built
**Spec:** `docs/superpowers/specs/2026-05-06-live-transcription-drawer-design.md`

## Current small win shipped first

Review-mode notes can now show the saved, post-upload transcript. This closes the immediate confidence gap after Deepgram finishes batch transcription, without adding streaming risk to the recorder.

## Goal

Add Granola-style live transcript visibility while an audio note is recording:

- Expand from the existing waveform chevron in `NoteWorkspaceView`.
- Show interim words in a dim style and finalized words in the normal style.
- Keep recording stable even if live transcription fails.
- Preserve the existing batch Deepgram pipeline as the source of truth after upload.

## Deepgram behavior to design around

Deepgram's streaming API supports interim results with `interim_results=true`. Interim text is explicitly provisional and can change before the service sends finalized segments. Their current guidance for conversational streams is to use endpointing in the 300-500ms range, process `is_final` segments, and not rely on `speech_final` alone because long utterances can produce multiple final chunks before a pause.

For raw audio packets, Deepgram requires declaring encoding and sample rate. For Loomola, the likely v1 format is mono `linear16` PCM at 16kHz, produced with `AVAudioConverter` from the recorder's 48kHz buffers.

Docs checked 2026-05-12:

- https://developers.deepgram.com/docs/interim-results
- https://developers.deepgram.com/docs/understand-endpointing-interim-results
- https://developers.deepgram.com/docs/encoding

## Recommended architecture

Use a desktop-to-Deepgram WebSocket for audio, with a server-minted short-lived token if Deepgram Management API permissions are available. If token minting becomes a delay, use a backend WebSocket proxy as a fallback only after confirming Coolify/Next can reliably hold long WebSocket connections.

The stable v1 path:

1. Desktop records exactly as it does today.
2. `LiveTranscriptionCoordinator` receives a copied audio stream from the mic/system capture path.
3. Coordinator converts to 16kHz `linear16` PCM and sends 100ms frames to Deepgram.
4. Coordinator reduces Deepgram messages into:
   - finalized transcript cards
   - one provisional tail
   - connection state
5. Drawer renders those values only while recording.
6. On Stop, the live snapshot can be saved for immediate review.
7. When the existing batch transcript arrives, batch replaces live text as the durable transcript.

## Phases

### Phase 1 — Reducer and no-risk UI shell

- Add `LiveTranscriptSegment` and a pure reducer for `is_final`, `speech_final`, interim text, and empty-result messages.
- Add unit tests for interim replacement, final append, duplicate final chunks, empty messages, and reset on new recording.
- Add an expandable drawer shell wired to local fake segments only.

Acceptance: The UI can be reviewed without any live network call.

### Phase 2 — Audio tap without network

- Add a multicast audio callback so live transcription can observe buffers without stealing them from the recorder.
- Convert copied buffers to mono 16kHz PCM.
- Log frame counts and peak levels to OSLog.

Acceptance: Starting a recording still produces valid uploaded audio, and the live path logs non-zero frames without changing system audio behavior.

### Phase 3 — Deepgram streaming behind a flag

- Add a disabled-by-default desktop preference, `liveTranscriptionEnabled`.
- Add the authenticated token/proxy route.
- Implement WebSocket open/send/receive/close in `LiveTranscriptionCoordinator`.
- Soft-fail to "Full transcript will appear after upload" if streaming errors.

Acceptance: With the flag on, a one-minute mic test shows live interim text and still uploads normally. With the flag off, behavior is exactly today's recorder.

### Phase 4 — Granola-grade drawer

- Wire the recording-bar chevron to the real drawer.
- Render finalized cards plus dim provisional tail.
- Add auto-scroll unless the user scrolls upward.
- Add copy-all and collapse controls.

Acceptance: During a real call, the drawer provides a visual proof that words are being captured.

### Phase 5 — Persistence and replacement

- Add `POST /api/notes/[id]/transcript/live` for the stop-time live snapshot.
- Mark live transcript source as temporary in the server response.
- Let the existing batch webhook overwrite the temporary transcript when final batch text lands.

Acceptance: Immediately after Stop, the user can review live text; after batch finishes, the saved transcript becomes the batch transcript.

## Risks and guardrails

- **Recorder stability is higher priority than live text.** Live transcription must never block Stop, upload, recovery, or AI notes.
- **Audio routing must remain untouched.** The live tap copies buffers; it must not take ownership of the audio graph or output device.
- **Do not write every interim result to Postgres.** Persist only on Stop, then replace with batch.
- **Keep it feature-flagged until proven.** Default-on can come after real call testing.

## Test checklist

- Mic-only one-minute note: live words appear, Stop uploads, Generate notes still works.
- Zoom/system-audio note: user still hears the call, live words appear if system audio is enabled.
- Live transcription disabled: no Deepgram WebSocket opens, normal batch transcript still works.
- Wi-Fi off mid-recording: recorder continues, drawer shows a soft failure, upload still works when network recovers.
- Hour-long call: live drawer remains responsive, batch transcript replaces live transcript later.

## Recommendation

Build this as the next reliability-focused Granola-parity milestone, but keep it separate from small UI fixes. It touches the most fragile parts of the product: audio capture, long-lived networking, and user trust during active calls.
