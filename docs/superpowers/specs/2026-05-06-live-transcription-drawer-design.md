# Live Transcription Drawer — Granola-parity real-time transcript while recording

**Author:** Claude Opus 4.7
**Date:** 2026-05-06
**Status:** Spec — not yet planned or built
**Driving feedback:** Ian, 2026-05-06 (during a live call recorded through Granola for reference) — *"They organize into paragraphs (presumably based on speaker timing) and they also differentiate with color the words that are kind of in progress or mid sentence per say, from the ones that are part of already completed sections… It's nice to be able to look up what someone just said sometimes on a call, and it gives you a visual check that the audio is indeed being correctly transcribed."*

---

## Why this milestone

Today the desktop's audio note flow captures audio cleanly and runs it through Deepgram's prerecorded API *after* the upload finishes. A 60-minute meeting becomes a perfect transcript ~5 minutes after the user clicks Stop. Useful for replaying a meeting, useless during it.

Granola's killer in-meeting moment is a transcript drawer that slides up from the bottom of the workspace, fills with rounded paragraph cards as the speaker talks, and renders an in-progress utterance in dimmer grey before "promoting" it to confirmed text once the model commits. Two payoffs every active call:

1. **Look up what was just said.** Someone references "the third bullet" three minutes ago — the user scrolls a paragraph or two and finds it. Without a live transcript, they're stuck asking the speaker to repeat.
2. **Trust signal.** Seeing the transcript track audio in real time is proof the recording is working. The current "did the mic catch that?" anxiety vanishes.

The workspace's audio-level meter already has a chevron-up placeholder (`recordingControlBar` in `NoteWorkspaceView.swift`) deliberately marked for "transcription drawer expansion." This spec is what fills that affordance.

---

## Goals

- Live transcript renders inside the workspace, expandable from a chevron next to the audio meter — Granola's exact spatial idiom.
- Two-tone rendering: confirmed text in `Text.primary`, in-progress text in `Text.tertiary` (or `secondary`), so the user sees the "still being decided" tail clearly.
- Paragraph-grouped layout: each completed utterance gets its own rounded-bg card, just like Granola's screenshot.
- Auto-scroll to the bottom unless the user has scrolled up — never yank them out of context while they're reading.
- Drawer surfaces standard controls in the header: search, copy-all, settings (language picker), minimize. Granola exact set.
- Transcript persists alongside the recording — when the existing batch transcript lands ~5 min after Stop, it replaces (not appends to) the live one for the persisted artifact, since batch tends to be more accurate.
- Cost is contained — streaming Deepgram is small, but live should only run while recording (never speculatively).
- No regression to the existing async/batch path. The Deepgram webhook + `generate_title_summary` chain keeps running, unchanged. Live transcription is *additive*.

## Non-goals (v1)

- **Live speaker diarization.** Streaming Deepgram supports it but the UX work (label updates as speakers join, retroactive corrections when the model decides "speaker 0" is actually two people) is meaningful. v1 renders flat utterances; v2 adds speaker labels.
- **Language switching mid-call.** Granola has a language dropdown — fine to render the affordance, but actually switching mid-stream means resetting the WebSocket. Defer to v2.
- **Multi-language / translation.** v1 is English-only. The "translate to" toggle Granola shows is post-MVP.
- **Local-only transcription.** Apple's `SFSpeechRecognizer` is the obvious privacy-first fallback for users who don't want Deepgram. Out of scope for v1; revisit if a user explicitly opts out of cloud transcription.
- **Backfilling live results into the AI summary prompt while recording.** The summary still runs after Stop — it's already long enough that streaming progress isn't worth the complexity right now.

---

## Architecture

### High level

```
┌─────────────────────────────┐    PCM frames    ┌─────────────────┐
│ MicrophoneCaptureCoordinator│─────────────────▶│                 │
│ SystemAudioCaptureCoordinator│─────────────────▶│ LiveTranscript  │
│  (existing — both already   │                  │  Coordinator    │
│   tap raw PCM samples)      │                  │  (new)          │
└─────────────────────────────┘                  └────────┬────────┘
                                                          │ WebSocket
                                                          │ (Deepgram
                                                          │  Streaming)
                                                          ▼
                                            wss://api.deepgram.com/v1/listen
                                                  ?model=nova-3
                                                  &interim_results=true
                                                  &punctuate=true
                                                  &channels=2
                                                          │
                                                          │ JSON deltas
                                                          ▼
                                                  ┌─────────────────┐
                                                  │TranscriptDrawer │
                                                  │ (new SwiftUI    │
                                                  │  view, in       │
                                                  │  workspace)     │
                                                  └─────────────────┘
```

### New components (desktop)

**`LiveTranscriptionCoordinator.swift`** — `@MainActor`, owns:
- A `URLSessionWebSocketTask` to Deepgram's streaming endpoint
- Two PCM tap subscriptions (mic + system audio), interleaved into the channels Deepgram expects
- A `@Published` `transcriptUtterances: [TranscriptUtterance]` ordered by time
- A `@Published` `interimTail: String?` — the still-being-decided phrase glued to the end
- Connection lifecycle: opens on `audio_note_recording_started`, closes on stop/discard, reconnects with backoff on transient failures (single retry, then fall back to async-only if the second attempt fails — never block the user's recording).

**`TranscriptUtterance`** struct — id (UUID), startedAt (Date), endedAt (Date), text (String), `isFinal: Bool`. v1 has no speaker field; v2 adds it.

**`TranscriptDrawer.swift`** — SwiftUI view, hosted inside `NoteWorkspaceView` as a bottom-anchored expandable panel. States:
- `.collapsed` — only the chevron-up + audio meter visible (today's recording control bar)
- `.expanded` — drawer slides up to ~50% of workspace height, scrollable, with the header controls (search, copy, settings, minimize) and the utterance list

**`TranscriptParagraph`** — single utterance card. Renders `text` in `Text.primary` for finalized utterances, `Text.tertiary` for the trailing in-progress text. Rounded `Bg.subtle` bg with the spacing pattern from the screenshot (~12pt vertical padding, 14pt horizontal, 8pt rounded corner, ~8pt vertical gap between cards).

### Deepgram authentication

Direct Deepgram WebSocket from desktop needs an API key. Two options:

**Option A — Backend-minted short-lived keys.** The desktop POSTs to `/api/transcribe/live-token` with its bearer token; the server uses the Deepgram Management API (`POST /v1/projects/{id}/keys`) to mint a temp key with `["usage:write"]` scope and a 1-hour TTL. Server returns `{ apiKey, expiresAt }`. Desktop opens the WebSocket directly to Deepgram with that key.

**Option B — Backend WebSocket proxy.** Desktop opens a WebSocket to the Loomola backend; backend opens a second WebSocket to Deepgram and forwards frames. Costs server bandwidth + adds a hop's latency. Saves us the Management-API round trip per recording.

**Recommendation: Option A.** Lower latency (no extra hop), no server bandwidth cost, and the temp key is throwaway. The Management API call happens once at recording start (~100ms); WebSocket is direct from the desktop after that. Mirrors how the existing `/api/uploads` mint signed R2 URLs.

### PCM piping

`MicrophoneCaptureCoordinator` already exposes `nonisolated(unsafe) onMicrophoneSampleBuffer` for the compositor. Add a parallel callback for the live coordinator (or a single callback list — multicast). Same for system audio.

Deepgram streaming wants raw `linear16` PCM at 16kHz mono OR multi-channel with the Channels header. Mic + system audio are already 48kHz; we'd downsample to 16kHz and interleave (or send as 2-channel at 16kHz). Resampling via `AVAudioConverter`.

Frame the audio at 100ms windows (Deepgram recommends ≤250ms; 100ms keeps interim results snappy). Buffer + send as `WebSocketMessage.data(...)`.

### Server-side persistence

We already have a `transcript_chunks` table from G-M1 (used by AI Q&A retrieval). v1 of the live drawer **does not** write to it during recording — it'd add a write-amplification problem (every interim → final transition is a chunk update) without a clear consumer. Instead:

1. Live transcript stays purely client-side during recording.
2. On Stop, the desktop POSTs the final list of utterances to `POST /api/notes/<id>/transcript/live` for persistence (no user-visible flow change).
3. The existing async Deepgram batch path runs as today — when the webhook delivers the final batch transcript, the server replaces the "live" snapshot with the "batch" snapshot in `transcripts.text` since batch is empirically more accurate.
4. While the user reviews the just-stopped note (before batch lands), they see the live transcript. When batch arrives (~5 min later), the UI swaps to the more-accurate version. Realtime via Supabase Realtime on `ai_outputs` already exists — we'd extend it to include `transcripts.batch_at`.

### Cost

Deepgram nova-3 streaming: $0.0043/minute = $0.26/hour. A typical user recording 5 hours/week of meetings = $1.30/week ≈ $5/month at retail. Cheap enough to ship without billing changes.

If the user opts to disable live transcription (settings toggle), the workspace stays on today's behavior — chevron renders but expands to a "Live transcription is off — flip on in Settings" placeholder.

---

## UX details (Granola-shape)

From the user's screenshots of Granola during a live call:

**Drawer header (40pt strip):**
- 🔍 Search input (left)
- ◐ Settings/sliders icon
- 📋 Copy-all icon
- — Minimize chevron (collapses drawer back to the audio meter row)

**Drawer body:**
- Vertically scrollable
- Each utterance = a rounded card, `Bg.subtle` background, ~14pt horizontal padding, ~12pt vertical
- ~8pt gap between cards
- Confirmed text: `Text.primary`
- In-progress tail: rendered as the FINAL card (ungrouped, no rounded bg) until it commits and gets its own card
- Auto-scroll: pinned to bottom unless `scrolledUpFlag = true` (user dragged up). Resume auto-scroll when user scrolls back to within ~80pt of bottom.

**Drawer footer (mirrors recording control bar in collapsed state):**
- Audio level meter (already shipped)
- Stop button (already shipped)
- 🌐 English language pill (right side, opens picker — v1 read-only "English"; switching defers to v2)

**Animation:** drawer slides up with `LoomolaMotion.medium` curve, 250ms. Chevron rotates 180° on expand.

---

## Schema additions

None required for v1 — `transcripts.text` already accepts arbitrary text, and we replace it on batch arrival. If we later want per-utterance retention with timestamps for replay-scrubbing, add:

```sql
ALTER TABLE transcripts
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'batch'  -- 'live' | 'batch'
  CHECK (source IN ('live', 'batch'));
```

Plus persisting the utterance array (start/end/text) to a new `transcripts.utterances JSONB` column. Not in v1.

---

## Implementation phases

**Phase 1 — Plumbing (no UI yet, ~1 day)**
- Server: `POST /api/transcribe/live-token` route. Calls Deepgram Management API. Returns `{ apiKey, expiresAt }`. Auth via existing bearer token.
- Desktop: `LiveTranscriptionCoordinator` opens WebSocket, receives interim + final messages, logs them via `Logger` for debugging.
- Audio pipe: 48kHz → 16kHz resample + 100ms framing.
- Tests: unit tests on the coordinator's reducer (interim → final state transitions); manual E2E to verify Deepgram receives and responds.

**Phase 2 — UI drawer (~1.5 days)**
- `TranscriptDrawer` SwiftUI view + `TranscriptParagraph` card.
- Wire the chevron in `recordingControlBar` to expand the drawer.
- Two-tone rendering of in-progress vs final.
- Auto-scroll-to-bottom with user-override detection.

**Phase 3 — Persistence + replacement (~half day)**
- `POST /api/notes/<id>/transcript/live` to persist the live snapshot on Stop.
- When batch arrives via the existing webhook, replace the live snapshot in `transcripts.text`.
- Realtime publication so review-mode workspace flips to batch text when it lands.

**Phase 4 — Header controls (~half day)**
- Search input that filters the visible utterances.
- Copy-all (puts all confirmed text on the clipboard).
- Settings icon → opens a popover with: Live transcription toggle, language picker (v1 read-only "English").
- Minimize collapses the drawer.

**Phase 5 — Hardening (~half day)**
- Reconnect with single backoff on transient WebSocket errors.
- Soft-fail to async-only if Deepgram is unreachable (recording continues, drawer renders "Live transcription unavailable — full transcript will appear after upload").
- Telemetry: log utterance count + final word count + total duration to OSLog for cost-correlating later.

**Phase 6 (deferred, separate spec) — Speaker diarization, language switching, on-device fallback.**

Total v1 estimate: ~3.5 working days.

---

## Open questions

1. **Should live transcription be on by default?** Default-on keeps the experience symmetric with Granola; default-off avoids surprise Deepgram costs. Recommend default-on with a Settings toggle to disable.
2. **Long meetings — does Deepgram drop us at any duration?** Their docs claim no hard cap; reconnect-on-disconnect is the safe pattern regardless.
3. **What if mic + system audio drift? Deepgram interleaves channels by frame — if one stream is paused (Pause/Resume work in Stage 6 was reverted, but if it lands), the other shouldn't keep advancing alone.** Solution: synchronize both streams via the existing `PauseAdjuster` → live coordinator pauses with them.
4. **Privacy: should the Settings toggle make this clear that audio is sent to Deepgram?** Yes — settings copy should explicitly say "Audio is sent to Deepgram for live transcription" with a link to their privacy policy.

---

## What this unlocks

- The first meaningful feature gap to Granola closes.
- Confidence in recording quality improves (visible transcript = visible proof).
- AI Q&A on a single note (open follow-up in ROADMAP) gets richer signal — once we have per-utterance timestamps from streaming, we can scrub the audio to "where was this said" by clicking a sentence in Q&A. Live drawer is the prerequisite that gives us that timestamped data.
- Sets the stage for the v2 speaker-diarization layer — once the streaming pipeline exists, adding speaker labels is mostly UI work.

---

## Spec status

Spec only. Not planned, not assigned. Filed in the ROADMAP under "Open follow-ups (next milestones to spec)" so it surfaces during the next sprint planning pass.
