# Speaker recognition v2 (Granola parity): Implementation plan

**Date:** 2026-10-27
**Spec:** [`../specs/2026-10-27-speaker-recognition-v2-granola-parity-design.md`](../specs/2026-10-27-speaker-recognition-v2-granola-parity-design.md)
**Status:** Phase 1 and the mic-loss side track were approved and **built on 2026-10-27** (commits on `feat/speaker-recognition-v2`). They're awaiting migration, deploy and backfill approval. Phases 2 to 5 get their own task-level breakdown once the open questions they depend on are answered.

**Ian's decisions (2026-10-27):**
- Q6: auto-apply capture evidence (mic track, sole remote voice on a 1:1, later meeting-app names) with undo; AI-inferred names stay suggestions.
- Q5: the wrong accepted rows go to a one-time review list (`needs_review`) and are never silently fixed.
- Q2: meeting-app names via Accessibility, Zoom first, but only after Phases 1 to 3.
- Q1: voice embeddings later.

**As built (deviations from the task list below):**
- Profile and reconcile run inside the `suggest_speakers` job, which is now enqueued from `persistTranscriptAndFanOut`, rather than inside the transcript-write transaction. Live → batch needs no old words (channel rule), and batch → batch user rows go to `needs_review` instead of a time-overlap remap.
- The eval scorecard and the backfill are one script (`scripts/backfill-speaker-v2.ts`); its dry run is the scorecard.
- Auto-apply shipped in Phase 1 (Q6 = yes), with a "Not <name>" undo on desktop and web.
**Style:** TDD. Pure logic first, under `src/lib/speaker-profile/` and `src/lib/speaker-suggestion/`, then wiring, then UI. Each phase ships on its own and is scored with the same offline eval script.

## Phases at a glance (ordered by impact ÷ effort)

| Phase | What it fixes | Effort | Depends on |
|---|---|---|---|
| **1. Correct the data** | Stale suggestions after live→batch replacement (27 of 32 batch notes with rows); Me found from the mic instead of talk time; Me identified on no-attendee calls; 1:1 names correct | ~1.5–2 days | none |
| **2. Me/Them everywhere + speaker-aware notes** | Saved transcripts keep Me/Them on desktop and web; Them / Them N labels; AI notes see who said what; health line; LLM pass for no-attendee calls | ~2 days | Phase 1; open questions 3, 6, 7 |
| **3. Granola-grade relabel** | Searchable popover, inline new person, clear, merge voices, "Update notes with new names", Check speakers | ~1.5 days | Phase 2 |
| **4. Meeting-app speaker tags** | Real names for 3+ person Zoom/Meet/Teams calls, live and saved | spike 0.5–1 day, then ~3–4 days | Phase 2; open question 2 |
| **5. Voice memory (Path C)** | Names across recordings, in-person and calendar-less calls | ~1 week | Phases 1–3 live for 2 weeks; open question 1 |
| Side track: mic survives device change | Ian missing from transcripts when the mic dies mid-call | ~half day + device test | none (existing ROADMAP follow-up) |

**Recommended first phase: Phase 1, with the mic-loss side track alongside it.** Phase 1 is server-only. It doesn't change what the UI looks like, only whether the names it shows are true, and it fixes the most common failure, which is wrong names rather than missing ones.

---

## Phase 1: Correct the data (~1.5–2 days)

### Schema: migration `0034_speaker_v2_profile.sql`

- `ALTER TABLE transcripts ADD COLUMN speaker_profile jsonb;`
- `ALTER TABLE media_objects ADD COLUMN r2_activity_key text;`
- `ALTER TABLE speaker_assignments ADD COLUMN transcript_version text, ADD COLUMN needs_review boolean NOT NULL DEFAULT false;`
- Update `drizzle/meta/_journal.json` (idx 34) and `src/db/schema.ts`. Check that the meta snapshot diffs cleanly (see the Stage 15 note about drizzle-kit re-emitting old DDL).
- **Acceptance:** `npm run typecheck`, `npm test` and `scripts/migrate.ts` run cleanly against a local DB. Existing rows are unaffected (all columns nullable or defaulted).

### Task 1: activity frames, pure (`src/lib/speaker-profile/activity.ts`)

- `encodeActivity({ mic: Float32Array|number[], system: … }) → Buffer` stores int8 dB per 100 ms, interleaved, plus a small header (version, frame ms, frame counts).
- `decodeActivity(buf)` is the inverse.
- `framesFromPcm(int16le, sampleRate, frameMs)` returns RMS dB per frame.
- **Tests** (`tests/unit/speaker-activity.test.ts`): round-trip; silence floor; mismatched track lengths (truncated mic) are preserved, not padded.

### Task 2: write frames in `mix_audio`

- **File:** `src/lib/queue/jobs/mix-audio.ts`. Add two extra outputs to the *same* ffmpeg invocation (`-map 0:a -ac 1 -ar 8000 -f s16le mic.pcm`, the same for system), then compute frames, upload `activity.bin` next to `mixed.m4a` and set `r2_activity_key`.
- The work is best-effort: a frames failure logs and never fails the mix.
- **Acceptance:** a local run on a fixture pair produces both `mixed.m4a` and `activity.bin` (~72 KB per hour).

### Task 3: `computeSpeakerProfile`, pure (`src/lib/speaker-profile/profile.ts`)

- Input: `words`, `provider`, optional decoded frames.
- Output: `SpeakerProfileEntry[]` (`speakerIdx, speechSec, source, micOnlyShare, systemShare`), plus `micCoverage` (mic track seconds ÷ system track seconds) and `micSilent` flags.
- Rules (from the spec):
  - live: 0 = mic, 1 = system;
  - batch: activity is 15 dB above each track's 10th-percentile floor; `mic` when micOnlyShare ≥ 0.40, `system` when systemShare ≥ 0.70, otherwise `mixed`;
  - `unknown` without frames, or when `micCoverage < 0.8` and no voice clears 0.25.
- **Tests:**
  - synthetic 1:1 (clean);
  - speakers-mode bleed: mic active whenever system is active, so the Me voice is still the only mic-only one;
  - truncated mic;
  - silent mic;
  - live provider;
  - fragment voices under 10 s.
- The threshold constants come from the 2026-10-27 probe; the eval script re-validates them.

### Task 4: `reconcileAssignments`, pure (`src/lib/speaker-profile/reconcile.ts`)

- Input: old rows (each with its `transcript_version`), old words or old profile, new words and new profile.
- Output: `{ deletePendingIds, remaps: [{id, newIdx}], needsReviewIds }`.
- Rules:
  - pending + stale ⇒ delete;
  - accepted ⇒ remap to the new index with the largest time overlap when it owns > 60% of the old index's speech, otherwise `needs_review`;
  - a live `0/1` maps through `source` (mic voice / sole system voice);
  - rows already on the current version are untouched.
- **Tests** (`tests/unit/speaker-reconcile.test.ts`):
  - the swapped-1:1 shape (2 real cases in prod) (live 0 = mic; batch index 1 is the mic voice ⇒ the accepted self row moves to 1 and the other person's row moves to 0);
  - a group call where the old index 1 was the system channel ⇒ pending row deleted;
  - accepted with low overlap ⇒ `needs_review`;
  - idempotent on re-run.
- How the remap finds its target:
  - **Live → batch** (the common case) needs no old words. Live index 0 is the mic, so it maps to the new `source = mic` voice. Live index 1 maps to the sole non-fragment system voice; when there are several, the row is set to `needs_review`. This is also the rule the backfill (Task 8) uses for historical notes, whose live words are long gone.
  - **Batch → batch** replacements (retry, dictionary reapply) use time overlap. The old words are read inside `insertTranscript`'s transaction, before the delete.

### Task 5: wire into transcript writes

- **Files:**
  - `src/db/queries/transcripts.ts` (`insertTranscript`, `insertLiveTranscript`);
  - `src/lib/transcription/persist.ts`.
- On every audio transcript write:
  1. compute the profile (load frames from `r2_activity_key` when present);
  2. store `speaker_profile`;
  3. run the reconcile, transactional with the replace;
  4. for `type = audio`, **enqueue `suggest_speakers`** (new: today only `generate_title_summary` and attendee PATCH enqueue it).
- **Acceptance:** an integration-style unit test with a mocked DB shows the live→batch replacement deletes the stale pending row, remaps the accepted row and enqueues once.

### Task 6: the `suggest_speakers` evidence ladder

- **Files:**
  - `src/lib/queue/jobs/suggest-speakers.ts`;
  - `src/lib/speaker-suggestion/compose.ts`;
  - `detect-self.ts`, which shrinks to the no-capture fallback.
- Gate changes:
  - Replace `hasExistingSpeakerAssignments` with "voices without a user decision on the current transcript version". Accepted and dismissed rows still win.
  - Move the attendee gate after the Me rung.
- The ladder:
  1. Me = profile voices with `source = mic` ⇒ `self_via_mic_capture`. More than one mic voice (diarization split Ian) means all of them are Me.
  2. Exactly one non-fragment remote voice and exactly one remote attendee ⇒ `remote_via_single_voice`.
  3. The existing LLM pass for the remaining voices (unchanged gate).
  4. `self_via_dominant_speech` **only** when the profile is `unknown`, the margin is ≥ 50% and attendees ≤ 1.
- Positional mapping for 3+ person calls is **removed**: it is a guess, and the Stage 17 design law forbids guessing.
- Stamp `transcript_version` on every write.
- **Write mode:** pending suggestions only in Phase 1. Auto-apply waits for open question 6.
- **Tests:** extend `speaker-suggestion-compose.test.ts`:
  - no-attendee note still gets Me;
  - group call never maps by position;
  - split Me;
  - fragment filter;
  - fallback margin.
- The existing 35 tests are updated where they encode the retired positional or dominant behaviour, and each change is called out in the PR.

### Task 7: offline eval script (read-only)

- **File:** `scripts/eval-speaker-attribution.mjs` (promotes the 2026-10-27 scratch probe).
- For each audio note in a date range:
  - mic and system coverage;
  - per-voice micOnly and system shares;
  - the mic-truth Me voice;
  - current rows and what the Phase 1 ladder would write;
  - disagreements with accepted rows.
- Prints counts only, never transcript text. It reuses frames from `r2_activity_key` when present and otherwise decodes tracks transiently.
- **Acceptance:** reproduces the spec's diagnosis numbers on prod (17 of 27 wrong self rows, 3 wrong accepted rows, 27 of 32 stale).

### Task 8: backfill (dry-run by default)

- **File:** `scripts/backfill-speaker-v2.mjs`.
- Default is a report only.
- `--execute`:
  - computes and stores `activity.bin`, `r2_activity_key` and `speaker_profile` for historical notes;
  - deletes stale *pending* rows;
  - re-enqueues `suggest_speakers`.
- `--execute` **never** edits accepted rows. It lists accepted disagreements (with media id and the proposed remap) for Ian to decide (open question 5).
- **Gate:** Ian reviews the dry-run output before `--execute`. Run only after the deploy is verified via `/api/health` `builtAt`.

### Phase 1 exit criteria

- On the eval script after backfill:
  - Me is correct on 100% of notes where mic truth is clear;
  - zero pending rows on stale versions;
  - every 1:1 with one attendee and a clean mic is named correctly.
- A fresh recording of a 1:1 and a group call after deploy shows correct Me and no system-channel-as-Ian row.
- Update ROADMAP.md, CLAUDE.md and AGENTS.md (speaker section and Stage 19 field notes) in the same PR.

---

## Phase 2: Me/Them everywhere + speaker-aware notes (~2 days)

Detailed tasks get written after Phase 1 ships. Scope:

- **Server:** pure `labelSpeakers(profile, assignments, people)`:
  - Me, then a name, then Them (one unnamed remote voice), then Them 1…N, then Speaker A… for unknown source;
  - `GET /api/notes/[id]/transcript` returns a `speakers` array (spec, API table);
  - one source of truth for both clients.
- **Desktop** (`UI/Notes/NoteWorkspaceView.swift`, `Upload/BackendClient.swift`):
  - saved-transcript bubbles align by `speakers[].source`, not by provider;
  - labels come from the DTO;
  - the suggestion bar and the no-attendee nudge read the same DTO;
  - a transcript-header health line ("N voices · M expected · mic missing after hh:mm").
- **Web** (`src/components/viewer/transcript-panel.tsx`, `src/components/notes/note-page-client.tsx`):
  - Me/Them styling;
  - suggestion banner with Apply names;
  - evidence on hover;
  - the same health line.
- **AI** (`src/lib/queue/jobs/generate-title-summary.ts`, action items):
  - speaker-labelled transcript builder (`Ian:` / names / `Them:`), from accepted and auto rows only;
  - prompt line telling the model the labels are capture- or user-verified.
  - If open question 3 = yes: enqueue one re-enhancement when a batch transcript replaces a live one on an already-enhanced note.
- **Auto-apply** (if open question 6 = yes): rungs 1–2 write accepted rows with their derivation; a one-click undo restores "Them".
- **LLM pass for no-attendee calls:** candidates are People mentioned by name in the transcript (token match against the People library), still behind `verifyAttributions`.
- **Tests:**
  - `labelSpeakers` units;
  - labelled-transcript builder units;
  - desktop XCTest on bubble alignment from the DTO;
  - web panel render test.

## Phase 3: Granola-grade relabel (~1.5 days)

- **API:** `PUT /api/speaker-assignments/[mediaId]` gains `createPerson`, `clear` and `mergeIntoIdx`; new `POST /api/recordings/[id]/speakers/recompute` (rate-limited).
- **Desktop and web popover:**
  - search field, attendees first, then recent, then everyone;
  - **+ Add "name"**;
  - **Not this person**;
  - **Same person as…**;
  - each action applies to all of the voice's segments.
- **"Update notes with new names":** shown after any relabel on an enhanced note. Re-runs enhancement with the labelled transcript and never auto-runs.
- **Check speakers banner:** shown when `needs_review` rows exist.
- **Tests:** API route units (validation, ownership, merge semantics); popover behaviour tests on both clients.

## Phase 4: Meeting-app speaker tags (spike 0.5–1 day, then ~3–4 days)

- **Spike** (time-boxed, desktop only, no product code), with a go/no-go written into this plan:
  - Can `AXUIElement` reading of **Zoom Workplace** (gallery and speaker view) reliably yield `{display name, is-speaking}` at about 4 Hz?
  - The same question for Teams desktop.
  - Can Loomola's Chrome extension read Meet's active-speaker DOM?
  - Loomola already asks for Accessibility in its permissions preflight (optional today).
- **Build** (if go):
  - `ActiveSpeakerTracker` (desktop `Meeting/`) records `{t, endT, displayName, app}` spans during audio notes;
  - uploads them with the recording (`POST /api/recordings/[id]/speaker-events`, new `recording_speaker_events` table);
  - the live drawer shows names on remote bubbles in real time;
  - server rung 3 runs a pure overlap vote: a voice is named when ≥ 60% of its system-sourced speech overlaps one display name, and that name is resolved to a Person via the attendee list, then the People library, then a create suggestion.
- **Fail closed:** no events means Me/Them as before. Feature flag per app.
- **Tests:**
  - overlap-vote units (crosstalk, a shared room device, display-name ≠ person name);
  - recorded AX fixture replays.

## Phase 5: Voice memory, Path C (~1 week)

Follows the 2026-05-07 addendum in the v1 spec: ECAPA-TDNN sidecar, `voice_samples`, `people.voice_embedding`, centroid on accept, and cosine thresholds as written there. Two changes:

- **Me is enrolled automatically** from mic-only segments, with no confirmation needed.
- A rung-5 match never overrides capture or meeting-app evidence.
- **Gate:** Phases 1–3 live for 2 weeks, plus open question 1.

## Side track: mic survives a device change (~half day)

The existing ROADMAP follow-up: restart the engine into the same `AudioAssetWriter` on input change during audio notes. It belongs next to Phase 1 because a dead mic removes Me from the transcript (15 of 50 probed notes had no usable Me signal; 7 had a truncated mic track).

## Test strategy (all phases)

- **Pure-logic units** for every rule (`tests/unit/speaker-*.test.ts`), using synthetic frames and word timestamps only. No real transcript text goes into fixtures, because the repo is public.
- **The eval script** is the before/after scorecard. Its output is pasted (as counts only) into each phase's PR description.
- **Desktop XCTest** for DTO → bubble mapping; **web render tests** for the panel.
- **Manual end-to-end matrix** after each deploy:
  1. Meet 1:1 on headphones
  2. Zoom team call with 4 or more people
  3. Ad-hoc FaceTime with no event
  4. Laptop speakers (bleed)
  5. In person with a single mic
  6. AirPods connecting mid-call

## Guardrails for whoever executes this

- Diagnose with `scripts/diag-speaker-suggestions.mjs` and the eval script before changing pipeline code (Stage 19 field note).
- User decisions win. Never delete or overwrite an accepted or dismissed row except through the remap rule.
- No speaker guessing: every name traces to capture, meeting-app, verbatim-transcript or voice evidence.
- Backfill writes only after Ian has read the dry-run report.
