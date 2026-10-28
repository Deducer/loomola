# Speaker recognition v2: Granola parity

**Status:** Diagnosis and design for review. Nothing here is built yet. Open questions for Ian are at the end.
**Date:** 2026-10-27
**Supersedes (in part):** the Path B rules in [`2026-05-04-speaker-recognition-design.md`](2026-05-04-speaker-recognition-design.md). Path C (voice embeddings) from that spec is kept as Phase 5 here.
**Plan:** [`../plans/2026-10-27-speaker-recognition-v2.md`](../plans/2026-10-27-speaker-recognition-v2.md)

## Goal

"Upgrade Loomola for better speaker recognition: follow how Granola does it, for UI and everything."

In practice, that means a transcript where:

1. Your own words are always marked **Me**, live and after the call, on desktop and web, with no setup.
2. Other people carry their real names whenever there is evidence for it, and an honest **Them** / **Speaker N** label when there isn't.
3. Fixing a name takes one click and applies to everything that voice said.
4. The AI notes know who said what, so action items get the right owner.

## Diagnosis: what fails today (prod, read-only, 2026-10-27)

Sample: every native audio note since 2026-07-02, the day batch transcription moved to mono + diarization. There are 56 notes; 54 have transcripts, and 52 of those are batch transcripts. All numbers come from read-only queries plus a read-only audio-energy probe of the stored mic and system tracks. No job was enqueued and no row was changed.

### Failure 1 (the big one): suggestions are computed against a transcript that is later thrown away

The timeline for a desktop audio note:

1. While recording, the desktop streams the **live** transcript. Its speaker indices are capture channels: `0 = mic (Me)`, `1 = system audio (everyone else)`.
2. At stop, the live transcript is saved (`provider = deepgram-live`) and note generation runs. `generate_title_summary` then enqueues `suggest_speakers`, which runs against the **live** indices.
3. A few minutes later the **batch** transcript (mono mix + diarization) replaces the live row (`persistTranscript`, delete then insert). Batch speaker indices are diarization order. They are unrelated to the live indices.
4. Nothing re-runs `suggest_speakers` for audio, and `hasExistingSpeakerAssignments` would block it anyway. The old rows stay keyed to indices that now mean someone else.

Evidence:

- **27 of the 32** batch-transcript notes that have any `speaker_assignments` rows got them *before* their current transcript was written. Their suggestion timestamps predate the transcript row by between 1 minute and 19 hours.
- On the live transcript, group calls fall through to the "self via dominant speech" branch, because voices (2) never equal attendees + 1. The system channel almost always out-talks the mic, so the rule labels **index 1, the system channel (everyone except Ian), as Ian**. 19 pending and 3 accepted rows have this derivation. Nearly all of them sit on index 1, even when the batch transcript's dominant voice is a different index.
- Ground truth from the mic track (see "The capture signal we already have" below): on the 34 notes where the mic signal is unambiguous, **17 of 27** existing "this voice is Ian" rows point at the wrong voice.
- Accepted names are affected too. **3 accepted rows are wrong**. In 2 of them, 1:1s, the two names are swapped: Ian's name sits on the other person's voice, and vice versa. The third is a group call. The 1:1 fast path (`self_via_source_channel`) was correct on the live transcript, but after re-indexing it is a coin flip. Diarization index 0 is whoever spoke first.
- **Today's 5-person team call** (2026-10-27, still processing) shows the bug in flight. It has a live transcript with two capture voices and 4 attendees, plus a pending suggestion that labels index 1 (the system channel, i.e. the other four people) as Ian. When the batch transcript lands, that row survives and pins Ian's name onto whichever diarized voice is index 1. (Not touched, per instructions.)

**Fix:** tie assignments to the transcript they were computed on. Recompute when the transcript changes, and never use "dominant speech" to find Me when the capture channels say who Me is.

### Failure 2: "Me" is guessed from talk time instead of read from the mic

`detectSelfSpeakerIdx` picks the speaker with the most speech. That is wrong on most group calls: on one 16-invitee call, Ian spoke 31 s out of about 20 minutes of speech. It is also wrong on 1:1s where the other person talks more. Meanwhile, Loomola records the mic and system audio as **separate tracks** and keeps both in R2 (`r2_mic_key`, `r2_systemaudio_key`; 51 of 54 notes have both). That is exactly Granola's Me/Them signal, and the matcher doesn't use it on batch transcripts.

### Failure 3: the attendee gate and the count rule leave most calls unnamed

| Shape (54 notes with transcripts) | Count |
|---|---|
| No attendees (ad-hoc Zoom, FaceTime, calendar blocks without invitees); the worker exits before doing anything | 14 (26%) |
| Voices = attendees + 1 (strict rule can fire, positional, so a guess for 3+ people) | 14 |
| Fewer voices than attendees + 1 (no-shows, or diarization merges voices) | 17 |
| More voices than attendees + 1 (diarization splits one voice, e.g. 12 voices for a 6-person call) | 9 |
| Single voice | 5 |

Over these four months, the Stage-17 LLM evidence pass produced **3** suggestions in total.

### Failure 4: the user rarely gets a usable answer

Across the 49 multi-voice notes since July: **8** are fully named, **25** have pending suggestions nobody accepted, and the rest have nothing. Given Failures 1 and 2, not accepting was the right call: a large share of those pending suggestions are wrong.

### Failure 5: the mic track itself is often missing or silent

Of 50 probed notes, **7** have a mic track much shorter than the system track (e.g. 0 of 41 min, 2 of 82, 1 of 33). In all, **15 of 50** have no usable Me signal: truncated, silent, or too quiet. Two notes sit at 17–19% mic-only, which looks like a low-gain mic rather than a dead one, so threshold tuning is part of Phase 1. Me is unambiguous on **34 of 50 (68%)**. That is the known "mic dies on device change" bug (ROADMAP open follow-up) or a silent device. When it happens, Ian's own voice is absent from the transcript and no speaker logic can recover him. Speaker quality depends on capture reliability.

### Failure 6: the surfaces lose Me/Them after the call, and the AI never sees speakers

- **Desktop:** the live drawer renders Granola-style **Me** bubbles (right) and **Call audio** bubbles (left). Once the batch transcript replaces the live one, every bubble goes left-aligned as "Speaker N". The Me/Them distinction disappears at exactly the moment the note gets read.
- **Desktop relabel menu:** a flat list of the whole People library (50 people today), with no search, no "new person", and no "not this person".
- **Web** (`transcript-panel.tsx`): per-speaker assign popover and ✓/✗ on suggestions, but no Me/Them styling, no suggestion banner, and no evidence on hover.
- **AI notes:** `buildAudioNotesEnhancementPrompt` receives `transcript.fullText`, which has **no speaker labels at all**. It also usually runs on the live transcript, before the batch transcript exists. "Action items with real owners", the main reason Granola users want speaker tags, is impossible today.

## How Granola does it (public sources, October 2026)

Sources: Granola Help Center pages *How transcription works*, *Speaker tags*, *Speaker tags in Zoom*, *Speaker tags in Google Meet*, *How transcription works on mobile*, and the public API docs (`Get Note`). Reviews (tl;dv, Jamie, echo99, LUCI) and the shape of Loomola's own Granola import were used as cross-checks.

| Area | Granola behavior |
|---|---|
| Capture | Desktop app captures **microphone** and **system audio** as two streams, with no bot. Audio is never stored. |
| Default labels | **Me** = mic, **Them** = system audio. Live transcript panel: green bubbles on the right for Me, grey on the left for Them. |
| Naming others | **Speaker tags** (2026, on by default): reads the meeting app's **participant display names and active-speaker indicator**. Zoom desktop and Teams desktop use macOS Accessibility; Google Meet uses Chrome Accessibility or Granola's Chrome extension. Each Them segment gets the name of whoever the app showed as speaking at that moment. |
| Limits they document | Not retroactive (live only). No names for shared room devices, overlapping speech, the Zoom web client, or other platforms (Webex etc. stay Me/Them). A wrong display name gives a wrong label. |
| In person / single mic | Mobile app diarizes into **Speaker A, Speaker B…**, with no names. |
| Fallback naming | When no tags exist, the AI "infers speakers from contextual clues" in the notes, and you "correct a name directly in your notes or ask Granola Chat to update it". No documented per-speaker relabel in the transcript. |
| Cross-meeting memory | None documented. Competitors (Jamie, echo99) advertise voice memory as their differentiator. |
| Data model (API) | Each transcript item has `speaker.source` (`microphone` / `speaker`), `speaker.attribution` (`me` / `them`), an optional `diarization_label` ("Speaker A"), and a name when tagged. |

The lesson: **Granola's accuracy comes from capture signals, not from guessing.** Me is the mic. Others are named by the meeting app itself. Diarization and AI inference are fallbacks. Loomola's v1 started from the fallbacks. v2 inverts that.

Where Loomola can beat Granola:

- Loomola **keeps the audio**. It can name speakers after the fact, re-run attribution, and later learn voices (Path C). Granola can do none of these.
- Loomola has an explicit relabel UX that applies to all of a voice's segments.

## Approaches considered

### Identifying "Me" on batch transcripts

| Option | How | Cost | Verdict |
|---|---|---|---|
| A. **Mic-energy alignment** | Per 100 ms frame, is the mic active while system audio is quiet? Score each diarized speaker by its share of mic-only frames. | Free: an ffmpeg decode of tracks we already store. Can be computed in `mix_audio`, which already reads both tracks. | **Recommended.** Probe on 50 prod notes: wherever Me is clear (34 notes), the Me voice scores 43 to 94% mic-only and every other voice scores 0 to 13%. One note is ambiguous, with a second voice at 17%. Robust to speaker bleed, because bleed coincides with system activity. |
| B. Transcribe the mic separately | Second Deepgram pass on the mic track. | Re-adds roughly the minutes Stage 11 removed. | Rejected: A gives the same answer for free. |
| C. Voice embedding of mic segments | ECAPA voiceprint. | Python sidecar. | Later (Phase 5). A seeds it with free, perfectly labelled "Me" samples. |

### Naming everyone else

| Option | Signal | Coverage | Effort | Verdict |
|---|---|---|---|---|
| 1. Attendee rules, fixed | 1 remote voice + 1 remote attendee ⇒ name; Me removed from the count first | 1:1s (10 of 54 notes), plus groups where diarization lands one remote voice | Small | **Phase 1–2.** The cheapest real win. |
| 2. LLM transcript evidence (Stage 17), extended | Names spoken in the transcript, verified verbatim | Any call; also no-attendee calls against the People library | Small | **Phase 2.** Keep the never-misattribute gate. |
| 3. **Meeting-app active speaker** (Granola's speaker tags) | Accessibility read of Zoom / Teams desktop; Loomola's Chrome extension for Meet | Group calls on those apps (Zoom is the most common detected app in the data) | Medium–large; needs a spike | **Phase 4.** The real Granola-parity feature for 3+ person calls. |
| 4. Voice embeddings (Path C) | Cross-recording voiceprints | Everything, including in-person and no-calendar calls | ~1 week + sidecar | **Phase 5**, once Phases 1–3 have run for 2 weeks. |

## Design

### Data model

All changes are additive.

1. **`transcripts.speaker_profile jsonb`**: one entry per diarized speaker, computed whenever a transcript is written (live or batch) and replaced along with the transcript:
   ```json
   [{ "speakerIdx": 3, "speechSec": 438.2, "source": "mic", "micOnlyShare": 0.72, "systemShare": 0.07 }]
   ```
   `source ∈ mic | system | mixed | unknown`.
   - Live transcripts: index 0 = mic, 1 = system, by construction.
   - Batch transcripts: from mic/system activity frames. `mic` when `micOnlyShare ≥ 0.40`, `system` when `systemShare ≥ 0.70`, otherwise `mixed`.
   - `unknown` when tracks are missing (web recordings, imports) or the mic track is truncated or silent.

2. **Activity frames artifact**: `media_objects.r2_activity_key text`. `mix_audio` writes `activity.bin` (int8 dB per 100 ms for mic and system; ~72 KB per hour) beside `mixed.m4a`. Computing it there costs no extra download. It also allows re-scoring without touching audio again, and it powers a "mic dropped out at 12:04" warning.

3. **`speaker_assignments.transcript_version text`**: the `provider:created_at` of the transcript the row was computed or accepted against. On transcript replacement:
   - **pending** rows with a stale version are deleted and recomputed;
   - **accepted** rows are **remapped** by time overlap (old index → the new index whose words overlap it most, with live 0/1 mapped through `source`). When no new index owns more than 60% of the old index's time, the row is set to `needs_review`.

4. **`speaker_assignments.needs_review boolean default false`**. Backs a small "Check speakers" prompt. User decisions are never silently discarded.

5. **Derivation values** in `suggestion_confidence`. The column name is kept for compatibility.
   - New: `self_via_mic_capture`, `remote_via_single_voice`, `meeting_app_active_speaker` (Phase 4), `voice_match` (Phase 5).
   - Retired from new writes: `self_via_dominant_speech` (kept only when no capture tracks exist and the margin is ≥ 50%).

6. **Phase 4 only: `recording_speaker_events`** (media_object_id, t_sec, end_sec, display_name, app, source = `zoom_ax | teams_ax | meet_extension`), uploaded by the desktop with the recording.

### Pipeline

```
transcript written (live OR batch)
  └─ computeSpeakerProfile (pure; frames + words)        → transcripts.speaker_profile
  └─ reconcileAssignments (pure; old version → new)       → delete stale pending, remap accepted
  └─ enqueue suggest_speakers  (now also from persistTranscript for audio, not only after enhancement)

suggest_speakers (evidence ladder; first evidence wins per voice, never overwrites user decisions)
  1. Me      = profile.source == "mic" voice(s)            → self_via_mic_capture       (auto-apply)
  2. 1 remote voice + 1 remote attendee                     → remote_via_single_voice    (auto-apply)
  3. Meeting-app active-speaker overlap ≥ 60% of a voice    → meeting_app_active_speaker (auto-apply)   [Phase 4]
  4. LLM verbatim evidence (attendees, else People library) → llm_transcript_evidence    (suggest)
  5. Voice-embedding match                                  → voice_match                (suggest)      [Phase 5]
  otherwise → no row; UI shows Them (remote) / Speaker N (unknown source)
```

The attendee gate moves *after* step 1, so Me is identified on every note, including the 26% with no attendees.

**Auto-apply vs suggest.** Granola applies speaker tags with no confirm step. Loomola follows that only for **capture-based** evidence (steps 1–3), which is deterministic and checkable. Those rows are written as accepted with their derivation recorded, and one click undoes them. Inferential evidence (LLM, voice) stays a suggestion. See open question 6.

**Fragment voices.** Diarized voices under 2% of speech (or under 10 s) are ignored when counting remote voices, and are labelled with their nearest-in-time neighbour's name only if the user applies that name. This handles the "12 voices for 6 people" case without guessing.

### AI notes

- The enhancement and action-item prompts get a **speaker-labelled transcript**: `Ian:` for Me, names where assigned, otherwise `Them:` or `Speaker N:`. Names come from accepted plus auto-applied rows, never pending ones.
- When the batch transcript replaces the live one for a note that was already enhanced, re-run enhancement once with labels (open question 3: about one extra LLM call per meeting).
- After the user relabels speakers, offer **"Update notes with new names"** rather than silently regenerating. This mirrors Granola's "correct a name in your notes".

### UI (desktop workspace and web note page, same behavior)

1. **Me / Them layout everywhere.** Me voices go right-aligned in the accent bubble, others left-aligned, on live *and* saved transcripts. It is driven by `speaker_profile.source` (or by `source` on live), not by provider.
2. **Labels:** Me, then a person's name, then **Them** when there is exactly one unnamed remote voice, **Them 1 / Them 2…** for several unnamed remote voices, and **Speaker A / B…** only when the source is unknown (in person, single mic, imports). This is Granola's vocabulary plus echo99's numbering for the multi-voice case.
3. **Speaker chip popover** (click any label): search field with attendees first, then recent people, then the rest; **+ Add "typed name"** creates a Person inline; **Not this person** clears the label; **Same person as…** merges two diarized voices under one name. Every action applies to all of that voice's segments. Desktop and web share the same API.
4. **Suggestions:** names preview in place with a dotted underline and a ✦. A banner reads "Suggested speakers: A, B · Apply names", and hovering shows the evidence quote (desktop has this; web gains it). Auto-applied names show a quiet "Named from Zoom" or "Named from your mic" provenance on hover.
5. **Health line in the transcript header:** "4 voices · 5 expected · mic missing after 12:04" whenever something limits attribution. This makes Failure 5 visible instead of mysterious.
6. **Check speakers:** when any `needs_review` rows exist, a one-line banner opens the popover on the first voice needing review.
7. **Live note:** unchanged Me / Call-audio bubbles until Phase 4. After it, remote bubbles carry the meeting-app name in real time, as in Granola.

### API

| Route | Change |
|---|---|
| `GET /api/notes/[id]/transcript` | Adds `speakers: [{ idx, source, speechSec, label, personId, state: auto/accepted/pending/none, derivation, evidence }]` so both clients render from one server-computed label set. |
| `PUT /api/speaker-assignments/[mediaId]` | Accepts `createPerson { displayName, email? }`, `clear: true`, and `mergeIntoIdx`. |
| `POST /api/recordings/[id]/speakers/recompute` | New. User-triggered "Re-identify speakers": clears pending rows and keeps accepted ones. Rate-limited per recording. |
| `POST /api/recordings/[id]/speaker-events` | New, Phase 4. Desktop uploads the active-speaker timeline. |

### Non-goals

- No change to the transcription provider in Phase 1–3. A diarization A/B (nova-2 → nova-3, or a provider with an expected-speakers hint) is an open question, not a dependency.
- No per-word or per-paragraph speaker splitting UI. Granola doesn't have it, and voice-level relabel covers the real cases.
- No cross-tenant voiceprints, ever (unchanged from v1).

## Risks

- **Speaker bleed on laptop speakers:** handled by the mic-*only* criterion. Validated on prod notes; a speakers-mode call should be part of the test set.
- **Mic loss** (Failure 5) caps Me detection until the device-change follow-up ships. The health line makes it visible, and the follow-up should be scheduled next to Phase 1.
- **Remapping accepted rows** could move a name onto the wrong voice. Mitigation: the 60% overlap threshold, otherwise `needs_review`; plus a dry-run backfill report before any prod write.
- **Accessibility scraping (Phase 4)** is brittle across Zoom and Teams updates. Spike first; feature-flag per app; fail closed to Me/Them.
- **Auto-applied names** are a deliberate step away from v1's "always confirm". They are limited to capture evidence and can always be undone.

## Test strategy

- **Pure-function units:**
  - `computeSpeakerProfile` (synthetic frames + words, including bleed, truncation and silent-mic cases);
  - `reconcileAssignments` (live→batch remap, low-overlap → `needs_review`, user rows never deleted);
  - the evidence ladder (each rung, ordering, fragment filtering);
  - `labelSpeakers` (Me / Them / Them N / Speaker A rules);
  - the active-speaker overlap vote (Phase 4).
- **Offline evaluation script** (read-only, prod): `scripts/eval-speaker-attribution.mjs` reports, per note, mic ground truth against current and proposed labels, plus counts (Me found, 1:1 named, disagreements with accepted rows). It becomes the before/after scorecard for every phase. The 2026-10-27 probe is its prototype.
- **Backfill dry run:** `scripts/backfill-speaker-v2.mjs` defaults to a report and needs `--execute` to write; it never touches accepted rows without a remap above threshold. Ian reviews the report (including the 3 wrong accepted rows) before any write.
- **Desktop:** XCTest for bubble alignment and label mapping from the new `speakers` DTO.
- **Web:** unit tests for the panel's label rendering.
- **Manual end-to-end matrix** (each recorded fresh after deploy):
  1. Meet 1:1 on headphones
  2. Zoom team call with 4 or more people
  3. Ad-hoc FaceTime with no event
  4. Laptop speakers (bleed)
  5. In person with a single mic
  6. Mid-call AirPods connect (mic-loss path)

## Open questions for Ian

1. **Path C (voice embeddings) now or later?** Recommendation: later (Phase 5), after Phases 1–3 have run for 2 weeks. Phase 2 can cheaply start *storing* mic-only "Me" segments so enrolment is free when Path C lands. OK to collect those now?
2. **Phase 4 Accessibility read of Zoom / Teams / Meet:** OK for Loomola to read meeting-app UI (participant names, active speaker) the way Granola does? Which app first? The data says Zoom desktop, then Meet. Meet would go through Loomola's own Chrome extension rather than Accessibility.
3. **Re-run note generation automatically when the batch transcript lands** (better notes with speaker labels; about one extra LLM call per meeting), or only on demand?
4. **Diarization A/B:** spend roughly an hour of Deepgram minutes testing nova-3 (and optionally AssemblyAI with an expected-speaker count) on 5 recent group calls? Under-segmentation (17 notes) is a bigger problem than over-segmentation (9).
5. **Stale accepted rows** (3 known wrong: 2 swapped 1:1s and 1 group call): auto-remap them using the mic evidence, or list them in a one-time "Check speakers" review?
6. **Auto-apply without a click** for capture-based evidence (Me from mic, sole remote voice + sole attendee, meeting-app tags), as Granola does? Recommendation: yes, with undo. LLM and voice matches stay suggestions.
7. **Label vocabulary:** "Them" / "Them 1, 2" for unnamed remote voices, or keep "Speaker N"?
8. **Web vs desktop order:** desktop first (where notes get read), with web parity in the same phase? Or web later?
9. **Mic-loss fix priority:** the device-change follow-up directly limits speaker quality (15 of 50 probed notes had no usable Me signal; 7 had a truncated mic track). Pull it in alongside Phase 1?
