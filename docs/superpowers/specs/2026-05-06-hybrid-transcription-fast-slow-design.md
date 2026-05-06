# Hybrid Transcription — Fast (Deepgram) + Slow (local Whisper) modes

**Author:** Claude Opus 4.7
**Date:** 2026-05-06
**Status:** Spec — exploratory, not committed. User flagged "not sure I want it" as a potential follow-up. Filed so the design isn't lost if/when it gets pulled into a sprint.
**Driving feedback:** Ian, 2026-05-06 — *"Let me know how feasible/easy you think it would be if I wanted to switch to a non-Deepgram transcription option — like perhaps I could even have a fast mode and a slow mode, where slow mode would transcribe when my device sleeps using a local model or something."*

---

## Why this milestone (might) make sense

Today every Loomola transcript flows through the same path: audio uploads to R2, the `transcribe` pg-boss job hands it to Deepgram's prerecorded API, the webhook signs back ~5 min later, and the AI summary chain follows. It works, the quality is high, and the cost (~$0.24/hr) is small.

But three pressures push us to consider an offline option:

1. **Cost over a long time horizon.** $0.24/hr × dozens of hours/week of meetings starts to compound. A self-hosted user (the explicit positioning of Loomola — "replacing Loom's $20/mo subscription") may want zero ongoing API spend.
2. **Privacy.** Some recordings shouldn't leave the user's device — confidential 1:1s, legal calls, anything with regulated content. A local-only mode lets users record those without touching a third-party API.
3. **Network independence.** Deepgram requires network. A user recording on a flight, in a basement office, or with flaky Wi-Fi can't get a transcript today.

The provider-agnostic design from G-M1 (`TRANSCRIBE_PROVIDER`, `TRANSCRIBE_MODEL` env vars) anticipated exactly this. We just haven't exercised it.

## Goals

- Add a third value to `TRANSCRIBE_PROVIDER`: `local-whisper`. When set per-recording (via a Settings toggle on the desktop), the standard webhook flow is skipped — the desktop runs whisper.cpp locally and POSTs the resulting transcript to the server.
- Default stays Deepgram (the "fast mode"). Local Whisper is opt-in.
- Local mode is genuinely useful: ≥80% accurate on clean speech, runs on Apple Silicon without melting the fan, doesn't tank battery on laptop, completes within a reasonable window for typical meeting lengths (≤2× realtime for the recommended `small` model).
- The Stage-1.99 abstraction line holds — server-side AI summary / chapters / action items pipeline is **provider-agnostic** and treats a local-Whisper transcript the same as a Deepgram one.
- The user can switch modes per-recording, not just globally — "this one's confidential, transcribe locally; everything else, fast."

## Non-goals

- **Live transcription via local Whisper.** That's the streaming on-device case (Apple SFSpeechRecognizer territory) — separate spec. This one is post-upload batch.
- **A "transcribe during system sleep" mode in the literal Apple sense.** macOS suspends app CPU during sleep; we cannot run a transcription job through a sleep cycle. What we *can* do is run on idle — see the architecture section.
- **Cross-platform Whisper.** Windows / Linux desktops aren't built; this is Apple Silicon-only.
- **Replacing Deepgram.** We keep both vendors. Local Whisper is an alternative, not a replacement.

---

## Architecture

### Provider abstraction extension

`TRANSCRIBE_PROVIDER` becomes a tri-state: `deepgram` (default) | `whisper-api` (existing OpenAI Whisper API path, currently unused) | `local-whisper` (new). The first two run the existing server-side webhook chain; `local-whisper` short-circuits to a desktop-driven path.

A new per-recording column, `media_objects.transcribe_provider TEXT`, records which provider this recording's transcript came from. Default `null` → use the env-var default. When the desktop opts a recording into local mode, it sends `transcribe_provider: 'local-whisper'` in the create-upload payload, and the server's `transcribe` job reads it and bails ("local-whisper recordings transcribe on the desktop; no server-side action").

### Desktop-side: whisper.cpp

The widely-used C++ Whisper port. Build options on Apple Silicon:

- **whisper.cpp** with the `WHISPER_METAL=1` flag — Metal-accelerated GPU inference. Officially supported, well-tested.
- **mlx-whisper** — Apple's MLX framework. Newer, sometimes faster, but Python-only today.
- **WhisperKit** — pure Swift, Apple's MLX under the hood, MLPackage models. The cleanest fit for our stack but younger project; quality has caught up to whisper.cpp by 2025.

**Recommendation: WhisperKit.** Pure Swift means no C++ build complexity, no separate runtime, ships in our existing `swift build` pipeline. Quality and speed are now competitive with whisper.cpp + Metal.

### Model selection

Whisper comes in five sizes; trade speed for accuracy:

| Model | Disk | Apple Silicon speed | Quality (English clean speech) |
|---|---|---|---|
| `tiny` | 39 MB | ~5× realtime | "OK if you squint" — usable for keyword search, not for serious notes |
| `base` | 74 MB | ~2× realtime | Decent — Granola-tier minus the fluency |
| `small` | 244 MB | ~1× realtime | Very good — close to Deepgram for clean speech |
| `medium` | 769 MB | ~0.4× realtime | Excellent — Deepgram-tier |
| `large-v3` | 1.5 GB | ~0.15× realtime | Best — beats Deepgram on accent + noise |

A 1-hour meeting transcribed at:
- `small`: ~1 hour
- `medium`: ~2.5 hours
- `large-v3`: ~6.5 hours

Recommend `small` as the default, with `base` as a fast-but-rougher option and `medium` for users who can wait. `large-v3` is overkill for v1.

Models download on first use into `~/Library/Application Support/LoomDesktop/whisper-models/<model-name>.mlmodelc`. UI shows a one-time download progress bar.

### "Slow mode" runs on idle, not sleep

macOS forbids CPU work while the system is asleep. We can't legitimately defer to sleep. The honest behavior:

- The transcription job sits in a desktop-side queue (persistent on disk; `~/Library/Application Support/LoomDesktop/transcribe-queue.json`).
- A scheduler watches `NSProcessInfo` + idle time (`CGEventSourceSecondsSinceLastEventType`) and starts the job when:
  - User has been idle for ≥ 90s (no keyboard/mouse), OR
  - User has explicitly checked "Run now" on the queued recording's row, OR
  - The Mac is plugged in AND not in `.thermalState != .nominal`
- Pause when:
  - User becomes active again AND the recording isn't tagged "Run now"
  - Battery drops below 30% AND not plugged in
  - Thermal state crosses `.fair`

The user-facing copy is "Local transcription will run in the background while your Mac is idle. You'll see a notification when it's ready." Sets expectations honestly; users don't expect it to literally happen during sleep once they understand the constraint.

### Result handoff

When local Whisper finishes a recording:
1. Desktop POSTs the transcript to `POST /api/recordings/<id>/transcript/local` (new endpoint, bearer-auth).
2. Server validates the bearer token + recording ownership, writes to `transcripts.text` with `transcripts.provider = 'local-whisper'`, marks the row complete.
3. Server enqueues the existing `generate_title_summary` / `chapters` / `action_items` pg-boss jobs against this transcript (the AI side is provider-agnostic — works the same).
4. The dashboard / desktop Recent strip realtime-updates as if Deepgram had landed.

Same end state, different source.

### Settings UI (desktop)

In the existing `SettingsSheet` → new "Transcription" section:

```
Default mode:           [ Fast (Deepgram, ~5 min, ~$0.24/hr) ▾ ]
                          • Fast (Deepgram)
                          • Slow (local Whisper, ~1× realtime)
                          • Slow (local Whisper, fastest model)

Local model size:       [ small (~244 MB, recommended) ▾ ]
                          • base — fastest, OK quality
                          • small — recommended balance
                          • medium — slow, near-perfect

[Download model] [Delete model]

Run when:               ☑ Mac is idle
                        ☑ Mac is plugged in (battery > 30%)
                        ☐ Run immediately (drops battery faster)
```

Per-recording override is a Settings link in the workspace's ⋯ menu when a recording is being authored — "Transcribe locally for this note." Defaults to whatever the global setting says.

---

## Schema additions

```sql
ALTER TABLE media_objects
  ADD COLUMN IF NOT EXISTS transcribe_provider TEXT
  -- null = use env-var default; otherwise overrides per-recording
  CHECK (transcribe_provider IS NULL OR transcribe_provider IN ('deepgram', 'whisper-api', 'local-whisper'));
```

The existing `transcripts.provider` column from G-M1 already accepts an arbitrary string (default `'deepgram'`). The new `'local-whisper'` value just needs to be a recognized constant in the AI summary prompt-building code (no special handling — it's still `transcripts.text` to the LLM).

---

## API

**`POST /api/recordings/<id>/transcript/local`** (new)

Bearer-auth (existing desktop flow). Body:

```json
{
  "text": "Full transcript with punctuation...",
  "language": "en",
  "model": "small",
  "modelVersion": "v3",
  "durationSeconds": 3600,
  "elapsedSeconds": 4012,
  "wordCount": 8432,
  "segments": [
    { "start": 0.0, "end": 3.2, "text": "Welcome everyone to..." },
    ...
  ]
}
```

Response: `204 No Content` on success. Server side-effects:
1. Insert into `transcripts` (or upsert if a row exists from an aborted Deepgram path) with `provider = 'local-whisper'`, `text` populated.
2. Enqueue `generate_title_summary`, `chapters`, `action_items` pg-boss jobs against this transcript.
3. Realtime publication on `ai_outputs` already covers downstream UI updates.

Replay protection / abuse: the existing rate-limit middleware (`checkRateLimit` from Stage 3) covers this — `scope: 'transcript-local:visitor'`, max 60/hour/user is more than enough.

---

## Implementation phases

Total estimate: **~3 working days** for v1.

**Phase 1 — WhisperKit integration spike (~half day)**
- Add WhisperKit Swift package dependency.
- Build a tiny test harness: download `small` model, transcribe a known 30s clip, verify text + segments.
- Decide on model storage layout, lockfile, atomic-rename pattern.

**Phase 2 — Background scheduler (~1 day)**
- `TranscriptionQueue` actor (`@MainActor` + persistent JSON store)
- Idle detection via `CGEventSourceSecondsSinceLastEventType`
- Power state via `IOPSCopyPowerSourcesInfo` (battery + AC)
- Thermal state via `NSProcessInfo.thermalState`
- Queue lifecycle: enqueue on Stop, persist to disk, scheduler ticks every 30s
- Cancellation / pause / resume
- 4–6 unit tests on the scheduler decision logic (idle + power + thermal → run/pause)

**Phase 3 — Server endpoint + schema (~half day)**
- Migration: add `media_objects.transcribe_provider`
- `POST /api/recordings/<id>/transcript/local` route
- Bearer-token auth, RLS-respecting writes
- Enqueue downstream pg-boss jobs
- 3–4 integration tests

**Phase 4 — Settings UI (~half day)**
- Transcription section in `SettingsSheet`
- Model download UI with progress bar
- Per-recording override in workspace ⋯ menu
- Persisted preferences via `UserDefaults`

**Phase 5 — Hardening + observability (~half day)**
- Logger plumbing under `subsystem: cloud.dissonance.loom.desktop, category: transcribe`
- Failure modes: transcription crashes, partial output, queue corruption — all surface as toast + retry button
- Telemetry: hours transcribed locally vs hours via Deepgram (privacy: counts only, no content)
- Smoke E2E: record 5min audio note → mark "Transcribe locally" → idle the Mac → verify transcript lands and AI summary fires

---

## Open questions

1. **Diarization.** Whisper doesn't do speaker labels natively; we'd need `pyannote.audio` (Python) or a Swift port (rare today). For v1, local mode produces a flat transcript without speakers. Tag in the UI as "Speaker labels not available for local-Whisper transcripts."
2. **Language coverage.** Whisper is multilingual; the existing flow assumes English. The model handles 99 languages but per-recording quality varies. Default `language: "en"`; let users override per-recording.
3. **Should we let users keep BOTH transcripts (local + Deepgram) for the same recording?** Some power users would want to compare. Adds complexity; defer to v2.
4. **WhisperKit vs whisper.cpp.** WhisperKit is pure Swift, easier integration, similar speed on Apple Silicon. whisper.cpp is more battle-tested and supports older Macs. Recommend WhisperKit for maintainability; if a user actually has an Intel Mac it's a future-problem.
5. **Should "fast/slow" be the user-facing terminology?** "Slow mode" sounds bad. Granola says "Local mode" or "On-device." Recommend renaming the Settings copy to "Cloud (faster, costs $)" vs "Local (private, free, takes longer)" before shipping.
6. **What happens if the user closes the app with a queued local transcription?** Persist the queue to disk; resume on next launch. Already in the Phase 2 plan but worth calling out — failures here mean a recording sits in "transcribing..." forever.

---

## Synergy with the live-transcription drawer

If both ship: the live drawer (`2026-05-06-live-transcription-drawer-design.md`) covers the in-meeting moment via Deepgram streaming; this spec covers the post-meeting batch. A user who wants 100%-private flow would set live-drawer to off (or use Apple SFSpeechRecognizer fallback when that's added) AND set transcription provider to local-whisper. Net: nothing leaves their machine.

The two specs are independently valuable. They share no code; ship in either order.

---

## Recommendation

This is **valuable but not urgent**. It addresses a real long-term cost + privacy concern that doesn't block any current user need. The Deepgram path works, costs ~$0.24/hr, and most users will not care.

Ship if/when:
- User explicitly wants the privacy story (regulated work, confidential meetings)
- Cumulative Deepgram spend crosses some annoyance threshold
- An external user wants to self-host with no third-party API spend

Otherwise it sits in the backlog. The provider abstraction from G-M1 makes a future swap straightforward; the spec captures the design so we don't lose institutional knowledge.

---

## Spec status

Spec only. Filed in ROADMAP under "Open follow-ups (next milestones to spec)" with the explicit "exploratory, may not ship" tag. Not planned, not assigned.
