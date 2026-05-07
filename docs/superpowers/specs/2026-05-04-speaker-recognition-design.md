# Speaker Recognition — Auto-labeling across recordings

**Author:** Claude Opus 4.7
**Date:** 2026-05-04
**Status:** Spec'd, Path B ready to plan + build, Path C scoped for later
**Related plans:**
- Path B (v1): [`docs/superpowers/plans/2026-05-04-speaker-recognition-v1-attendee-match.md`](../plans/2026-05-04-speaker-recognition-v1-attendee-match.md)
- Path C (v2): plan deferred until v1 has shipped + lived for ≥ 2 weeks

---

## Why this milestone

G-M6 shipped per-recording diarization (Deepgram `diarize: true`) plus a `people` table and a `speaker_assignments` table that maps `(media_object_id, speaker_idx) → person_id`. The user can manually label each speaker in a recording's transcript card, and those labels persist within that recording.

What's missing: **the labels don't carry forward**. Every new recording starts at "Speaker 0", "Speaker 1" again. The user has to re-label even when it's the same two people they had a call with last week.

This spec covers the path to automatic speaker recognition across recordings. It's split into two phases because the right tech stack for "real" voice biometrics (Path C) is heavier than what we need for the most common case (Path B), and the user has explicitly asked us to ship the cheap win first and pick the right tool for C carefully when we get there.

## Goals

- Phase B (v1, this milestone): when a new recording is processed and the meeting context names exactly one external attendee (most common case for 1:1 calls), automatically suggest `speaker_idx → person` mappings using the calendar/extension-detected attendee data we already capture. UX matches the folder-suggestion pill: live "confirm Sarah?" affordances, persisted on accept.
- Phase C (v2, deferred): voice biometrics. Per-speaker voice embeddings stored on `people` rows; cross-recording cosine match identifies the same voice across calls. Auto-suggests with a confirm pill; covers 3+ person meetings and cases without meeting context.
- Both phases reuse the existing `people` + `speaker_assignments` tables and the existing transcript-panel popover. No schema rewrite; Path B is additive, Path C adds a vector column to `people`.

## Non-goals (explicit fence)

- **No diarization changes.** Deepgram per-recording diarization stays as the upstream signal source. We don't replace it.
- **No on-device voice biometrics in Path B.** Path B uses calendar context only.
- **No "create new Person from a meeting attendee" auto-magic in Path B.** If a new attendee email doesn't match an existing Person, we suggest creating one with the meeting attendee's name + email pre-filled, but the user clicks Accept to make the Person row.
- **No cross-tenant voice library.** A user's voice embeddings are scoped to their account; never shared.
- **No identification of speakers not in the user's `people` library.** If "speaker 3" is some random external participant we've never seen, we leave them as "Speaker 3" — not "Unknown female voice", not "Inferred Person 4".
- **Path B does not require Path C.** They're orthogonal; B ships standalone and C layers on top.

---

## Path B — Calendar / attendee elimination (v1)

### How it flows

```
Recording finishes → transcript persists →
  generate_title_summary completes →
  (existing) suggest_folder enqueued →
  (NEW)     suggest_speakers enqueued

suggest_speakers job:
  • Load: media_objects.attendees (JSONB), Deepgram speaker_idx set
  • If Deepgram detected exactly N speakers AND meeting context names N-1
    external attendees AND user has a self-Person:
      • Self-detection: which speaker_idx is the user?
        - Heuristic A: longest total speech tends to be the host (the user)
        - Heuristic B (better): user has a "self" voice fingerprint flag in
          people table; pick the speaker that matches when Path C is live;
          for Path B, fall back to Heuristic A
      • Remaining speaker_idx assigned to the meeting's attendees
        - Match attendee email/name (case-insensitive, fuzzy on name) to
          existing people rows
        - If exact email match → high confidence, auto-suggest
        - If fuzzy name match (Levenshtein ≤ 2 chars or token-set match)
          → medium confidence, auto-suggest
        - If no match → suggest creating a new Person with the attendee's
          name + email
  • Persist suggestion as speaker_assignments rows with a "suggested" flag
    (the user accepts to remove the flag, or rejects to delete the row)
```

### Schema changes

Two additive columns on `speaker_assignments`:

```sql
ALTER TABLE speaker_assignments
  ADD COLUMN is_suggestion boolean NOT NULL DEFAULT false,
  ADD COLUMN suggested_at timestamptz,
  ADD COLUMN dismissed_at timestamptz;
```

Why these columns:

- `is_suggestion`: distinguishes auto-suggested rows from user-confirmed rows. Existing UI logic that reads `speaker_assignments` only shows confirmed labels; the new pill UI reads both.
- `suggested_at`: informational; useful for "stale" logic later.
- `dismissed_at`: persisted dismissal lock. Suggestion never reappears for that recording's speaker_idx unless an explicit regen is triggered (no current trigger; AI regen doesn't re-run speaker assignment in v1).

One additive column on `people`:

```sql
ALTER TABLE people
  ADD COLUMN is_self boolean NOT NULL DEFAULT false;
```

The user's own Person row gets `is_self = true`. There can be at most one `is_self = true` row per owner (enforced by partial unique index). Bootstrapped: when the user first opens `/people`, if they have no self-Person, the page prompts them to create one with their email pre-filled from their auth user. Used in Path B for the host-vs-attendee split, and in Path C as the seed for the user's voice fingerprint.

### Classifier (Path B has none — pure rules)

No LLM call. Pure rules:

1. **Self-detection by speech volume.** Sum each speaker's total seconds of speech from `transcripts.wordTimestamps`. The speaker with the most speech in a recording where the user is hosting is overwhelmingly the user. (Holds for ~95 % of 1:1 sales/coaching calls. Edge cases — silent host, monologuing guest — produce a wrong guess; the user clicks ✗ once and the dismissal sticks.)
2. **Attendee → Person fuzzy match.** Existing `people` rows are matched by email (preferred), then by display name (token-set match, no Levenshtein in v1 — keep it simple).
3. **No match → suggested new-person creation.** The pill says "Add Sarah Chen as a new contact?" and clicking ✓ creates the Person row + applies the assignment in one transaction.

### UI

Same pill pattern as the folder suggestion. Two surface points:

1. **Transcript card on the note page** — when `speaker_assignments.is_suggestion = true` for any speaker_idx visible in the transcript, the speaker label shows the suggested name with a small "Suggested" indicator + tap-to-confirm. ✓ flips `is_suggestion` to false; ✗ deletes the assignment row and stamps `dismissed_at`.
2. **Dashboard card (optional v1.1)** — a small "labeling Sarah, Ian?" pill on the recording card if there's a pending speaker suggestion. **Defer to a v1.1 polish** unless trivial.

### Acceptance criteria (Path B)

- A new recording's `media_objects.attendees` JSONB contains exactly one external attendee.
- Deepgram returns exactly 2 speaker_idx values.
- The user has a self-Person (`people.is_self = true`).
- Then: opening the note shows "Speaker 0 — Ian (suggested)" and "Speaker 1 — <attendee> (suggested)" or similar, with confirm/dismiss affordances on each.
- ✓ on each suggestion persists the `speaker_assignment` row with `is_suggestion = false`.
- The same attendee in a future recording produces the same suggestion (because the Person row is matched by email).
- A 3+ person meeting falls through Path B without making suggestions (no UX clutter from low-confidence guesses).
- A meeting with no detected attendees falls through with no suggestions.
- The smoke E2E passes; no regression to existing manual speaker labeling.

### Effort

~1 day of focused work. Smaller than the folder-suggestion milestone because there's no LLM call, no embedding pipeline, no new ML cost.

### Risks (Path B)

| Risk | Impact | Mitigation |
|---|---|---|
| Self-detection wrong (user is silent or guest dominated) | Wrong auto-label | One ✗ click and dismissal sticks; user re-labels manually. Same recovery as today's manual flow. |
| Attendee email format from Chrome extension differs from `people.email` | Match misses | Normalize both sides (lowercase, trim) before compare. |
| Deepgram returns 1 speaker for a 2-person call (low signal) | No suggestion fires | Acceptable — Path B's job is to handle the cases it can. Manual labeling remains. |
| User's name in calendar invite differs from their `people.display_name` | Self-Person not matched | We don't match self by attendee data; we use `is_self = true` which is set explicitly. |

---

## Path C — Voice biometrics (v2, deferred)

When B has lived in production for ≥ 2 weeks and we know which calls B doesn't cover well, we layer C on top.

### What C buys us beyond B

- **3+ person meetings.** B can't disambiguate 3 attendees vs 3 speaker_idx; C can.
- **Meetings without calendar context.** If the user starts an audio note manually with no Meet/Zoom/Teams context, B has no attendees to match against; C identifies voices it has heard before.
- **Robustness when calendar invite lists wrong people.** Attendees often differ from who actually shows up; voice tells the truth.

### Approach

Per-speaker voice embeddings, stored as a vector centroid on each `people` row.

```sql
-- Path C migration (NOT part of v1 — sketch only)
ALTER TABLE people
  ADD COLUMN voice_embedding vector(192);  -- ECAPA-TDNN dim, or model-dependent
ALTER TABLE people
  ADD COLUMN voice_embedding_samples integer NOT NULL DEFAULT 0;

-- Per-recording per-speaker embedding (so we can re-derive the centroid
-- if we ever swap the model, and so we can drop bad samples without
-- re-running the whole pipeline)
CREATE TABLE speaker_embeddings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  media_object_id uuid NOT NULL REFERENCES media_objects(id) ON DELETE CASCADE,
  speaker_idx integer NOT NULL,
  person_id uuid REFERENCES people(id) ON DELETE SET NULL,
  embedding vector(192) NOT NULL,
  model_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON speaker_embeddings (person_id);
CREATE INDEX ON speaker_embeddings USING hnsw (embedding vector_cosine_ops);
```

### Pipeline

1. After transcript persists, segment audio by speaker using existing word-level timestamps.
2. For each speaker, take ~10 s of their longest contiguous utterances; extract a voice embedding via the chosen model.
3. Persist the per-speaker embedding to `speaker_embeddings`.
4. For each unassigned speaker_idx, cosine-match the embedding against all `people.voice_embedding` centroids for the user's account. If similarity > threshold (0.75 is a reasonable starting point for ECAPA-TDNN), auto-suggest the matched Person.
5. When the user accepts an assignment, append that recording's per-speaker embedding to the centroid: `centroid_new = (centroid_old * n + new_embedding) / (n + 1)`. Increment `voice_embedding_samples`.

### Tech-stack tradeoffs to decide before C ships

This is the big decision the user wants to think through, which is why C is deferred:

| Option | Pros | Cons | When to pick |
|---|---|---|---|
| **Pyannote Audio** (Python sidecar) | State-of-the-art accuracy, well-maintained, MIT-licensed | Python sidecar adds a service, GPU benefits exist but CPU is fine on M4 | Long-term default; right answer for production quality |
| **SpeechBrain ECAPA-TDNN** (Python sidecar) | Comparable accuracy to pyannote, simpler API | Same sidecar tax | Acceptable swap if pyannote licensing or velocity sucks |
| **Resemblyzer** (Python, single-file) | Trivially deployable, no model server | Lower accuracy, 256-d embeddings | "Cheap C" if we want to skip Python infra |
| **AssemblyAI cross-recording speaker ID** | No new infra; managed | Vendor swap from Deepgram OR adds a second vendor; cost | Only if we're already migrating off Deepgram |
| **OpenAI Whisper diarization v3+** | Same vendor as our LLM if we use OpenAI | Not designed for cross-recording ID; would still need a separate embedding step | Probably not |

The user's stated preference: "make sure we use the right tech for that" — implies they want to pick the option deliberately, not under deadline pressure. Path B buys us time.

### Effort (when C lands)

~1 week of focused work: model integration (sidecar service, CPU inference acceptable on M4 baseline), audio segmentation, embedding storage, cosine matching, threshold tuning, regression tests, UX for the same confirm-pill pattern. The pill UX itself is reused from Path B.

### Risks (Path C, anticipated)

- **Voice changes** (illness, phone call quality, headset vs studio mic) lower similarity — threshold needs to be tuned in the field.
- **Storing voice embeddings is biometric data** — for a single-user product this is fine, but if multi-tenant ever lands we need a privacy policy + opt-in flow.
- **Deepgram speaker_idx isn't always stable** even within a recording — if Deepgram says "speaker 0 here" but it's actually two different people sharing one channel (rare), the embedding is a blended mess. Mitigation: only embed segments where Deepgram had high confidence + the speaker had ≥ 5 s of contiguous speech.

---

## Roadmap fit

- **Now:** spec written; Path B ready to plan + ship in v1.
- **Next:** Path B (`docs/superpowers/plans/2026-05-04-speaker-recognition-v1-attendee-match.md`) — ~1 day.
- **Later:** Path C — revisit after Path B has lived for ≥ 2 weeks. Decide model + sidecar approach at that time.

## Out of scope (both paths)

- Multi-language voice models. We're English-only via Deepgram today; cross-language voice ID is a separate concern.
- Cross-tenant voice libraries.
- Real-time live speaker labeling during recording (we label after transcript completes).
- Speaker turn-detection improvements over Deepgram's diarization.
- Telemetry on accept rate.

---

# Addendum 2026-05-07 — Path C technology choice + research notes

After the Granola migration dogfood (2026-05-06/07), the user reaffirmed Path C as the right long-term direction and asked for a deliberate tech pick. Here's the May 2026 landscape and the recommended stack.

## Recommended stack (Path C v2 implementation)

- **Embedding model:** **SpeechBrain ECAPA-TDNN** (`speechbrain/spkrec-ecapa-voxceleb`).
  - 192-dim float, Apache-2.0, ~1.71% EER on VoxCeleb1.
  - CPU inference acceptable (~70 ms / utterance on M4); no GPU required for our volume.
  - Reach for **NeMo TitaNet-Large** (~0.66% EER) only if accuracy demands force it; heavier install, license still Apache.
- **Vector store:** existing pgvector — `people.voice_embedding vector(192)`.
- **Sidecar service:** small Python FastAPI app, `extract-embeddings` endpoint, takes a R2 audio key + speaker-segments JSON, returns `{speaker_idx → embedding[]}`. Deployed alongside the main container in Coolify (or as a separate Coolify service).
- **Worker job:** new `extract_voice_embeddings` pg-boss job, queued after `transcribe` completes for any media with audio. Calls the sidecar; persists per-speaker embeddings on `voice_samples` (new table — see schema below); updates `speaker_assignments.is_suggestion` based on cosine match.
- **Match step:** cosine similarity over `people.voice_embedding`, biased to candidates in `media_objects.attendees` when present.
- **Confirmation UX:** reuse the existing G-M13 speaker-suggestion pill in `transcript-panel.tsx`. On accept → update `people.voice_embedding` as a moving-average centroid of accepted samples; mark `speaker_assignments.is_suggestion=false`.

### New tables (proposed)

```sql
-- One row per (media_object, speaker_idx) embedding, separate from the
-- people-level centroid so we can recompute centroids if the model
-- version changes.
CREATE TABLE voice_samples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  person_id uuid REFERENCES people(id) ON DELETE SET NULL,
  media_object_id uuid REFERENCES media_objects(id) ON DELETE CASCADE,
  speaker_idx integer NOT NULL,
  embedding vector(192) NOT NULL,
  total_speech_seconds numeric NOT NULL,
  model_version text NOT NULL DEFAULT 'speechbrain/spkrec-ecapa-voxceleb',
  accepted_by_user boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (media_object_id, speaker_idx, model_version)
);

ALTER TABLE people
  ADD COLUMN voice_embedding vector(192),
  ADD COLUMN voice_embedding_sample_count integer NOT NULL DEFAULT 0,
  ADD COLUMN voice_embedding_updated_at timestamptz;
```

`people.voice_embedding` is the running centroid; `voice_samples` keeps the originals so we can rebuild it on model upgrade or after merges.

### Confidence rules (initial; tune in the field)

- **Auto-label** when cosine ≥ 0.55 AND speaker is in calendar attendee set.
- **Suggest** (pill UX) when 0.30 ≤ cosine < 0.55, or ≥ 0.55 but speaker is not in attendee set.
- **No suggestion** below cosine 0.30 — too risky; user labels manually.
- **Skip embedding extraction** for speakers with < 1.5 s of total speech (embedding quality collapses below that).

### Hooks into the existing G-M13 attendee-match v1

- The attendee-match pill (already shipped) writes `speaker_assignments.is_suggestion=true` rows. The new voice-match worker should **respect** any `is_suggestion=false` row (user already labeled it; don't second-guess) and only write into the same table where rows are absent or still suggestions.
- When attendee-match has high confidence AND voice-match has high confidence on the same speaker_idx, agreement → auto-accept. Disagreement → leave as suggestion + show both candidates.

## Research findings — May 2026 landscape

| Topic | Finding (source links below) |
|---|---|
| **OSS embedding model leaders** | NeMo TitaNet (~0.66% EER) > WeSpeaker (~0.7-1.2%) > SpeechBrain ECAPA (~1.71%) > pyannote/embedding (~2.8%) > Resemblyzer (~5-6%). All Apache or MIT. |
| **Hosted speaker-enrollment APIs** | Speechmatics is the only major STT API with a real cross-recording enrollment endpoint as of May 2026. Deepgram = diarization only. AssemblyAI's voiceprinting is on roadmap, not shipped. |
| **Calendar-attendee + diarization heuristic** | Industry-wide pattern, no published reference implementation. Our G-M13 v1 (count-equality + dominant-speaker) is already a clean version. Otter, Fireflies, Read.ai use the same general shape plus voice biometrics on top. |
| **Train-by-confirmation accuracy** | 1 sample → ~85% recall; 3-5 samples across different sessions → > 95%; ~10 samples plateaus ([MDPI 2024](https://www.mdpi.com/2076-3417/14/4/1329)). Standard pattern: centroid-of-accepted, cosine threshold, reject samples too far from centroid to avoid drift. |
| **Where it falls down** | Bluetooth headsets (~2× EER vs wired mic), similar-voice pairs (siblings/partners — embedding margin shrinks; confirmation UX essential), short turns < 1.5 s, far-field overlap (laptop on conf table, 6+ ppl). Pyannote 3.1 still misses ~11-19% DER on the last case. |
| **Real-world meeting accuracy** | [arXiv 2508.18913](https://arxiv.org/abs/2508.18913) reports speaker-tracking error 29.1% → 20.4% on noisy far-field with 2025 frameworks. Confirms: meeting audio is the hard regime; one round of confirmations is what gets to >95%. |

### Why ECAPA over TitaNet (decision rationale)

- TitaNet's 1% EER advantage doesn't matter at our volume (~50 unique people per user, ~5 hours of audio per week). The gap shows up in 1000+ class verification benchmarks; ours is a dozen-class identification task with explicit calendar-attendee priors that further constrain the space.
- ECAPA inference is < 100 ms on CPU per 5-second segment; TitaNet wants GPU for parity speed. Single-VPS Coolify deploy + no GPU means ECAPA fits without changing the infra story.
- ECAPA has ~5 years of production track record (Kaldi-derived, used by tens of products); TitaNet is newer and more locked into the NeMo toolkit's install footprint (2 GB+ on disk).

If accuracy turns out to be the limiter in practice, switching to TitaNet is a model-card swap + re-extracting from `voice_samples` (we kept the originals for exactly this reason) — no schema or API change.

### Why not Speechmatics' hosted enrollment

- Vendor lock-in: forces us off Deepgram entirely (or run two STT vendors in parallel).
- Cost: Speechmatics is per-minute-billed similar to Deepgram; doubles transcription cost for marginal accuracy gain over a self-hosted ECAPA.
- Privacy: voice embeddings stay on your VPS instead of in a third-party vendor's biometric store.

Worth re-evaluating if Path C ECAPA accuracy turns out to be insufficient AND Speechmatics' general transcription quality matches Deepgram's at our use case.

## Plan (Path C v2 — when picked up)

Rough sequencing, ~3-4 focused days:

1. New `voice_samples` table + `people.voice_embedding` columns (migration).
2. Python sidecar service: FastAPI + speechbrain + ffmpeg (segment extraction). Coolify-deployable container.
3. New pg-boss job `extract_voice_embeddings`, queued from the existing transcribe handler. Hits the sidecar; persists samples.
4. Centroid-update logic on `speaker_assignments` accept (re-average over `voice_samples WHERE accepted_by_user=true`).
5. Match step in the existing `suggest_speakers` worker: combine attendee-match prior + voice-match cosine; respect existing accepted assignments.
6. UX is **unchanged** — same suggestion pill the user already lives with from G-M13 v1. The pill just gets smarter over time as embeddings accumulate.

## Sources (May 2026)

- [pyannote/speaker-diarization-3.1](https://huggingface.co/pyannote/speaker-diarization-3.1) — current pyannote pipeline
- [pyannote/embedding](https://huggingface.co/pyannote/embedding) — pyannote's standalone embedding model
- [SpeechBrain ECAPA-TDNN model card](https://huggingface.co/speechbrain/spkrec-ecapa-voxceleb) — recommended pick
- [NVIDIA NeMo TitaNet model card](https://huggingface.co/nvidia/speakerverification_en_titanet_large) — accuracy ceiling
- [WeSpeaker (NPU-Speech) GitHub](https://github.com/wenet-e2e/wespeaker) — production-tuned alternative
- [Comparison of Modern Deep Learning Models for Speaker Verification (MDPI 2024)](https://www.mdpi.com/2076-3417/14/4/1329) — accuracy benchmarks
- [Speechmatics Speaker Identification](https://docs.speechmatics.com/speech-to-text/features/speaker-identification) — only hosted enrollment
- [AssemblyAI Speaker Identification](https://www.assemblyai.com/docs/speech-understanding/speaker-identification) — name-mapping only, no voiceprints yet
- [AssemblyAI Speaker Fingerprinting roadmap blog](https://www.assemblyai.com/blog/speaker-fingerprinting-voice-ai)
- [Deepgram API Overview](https://developers.deepgram.com/reference/deepgram-api-overview) — confirms diarization-only
- [arXiv 2508.18913: Robust Speaker Verification in Highly Noisy Environments](https://arxiv.org/abs/2508.18913)
- [BrassTranscripts 2026: Best Speaker Diarization Models Compared](https://brasstranscripts.com/blog/speaker-diarization-models-comparison)
