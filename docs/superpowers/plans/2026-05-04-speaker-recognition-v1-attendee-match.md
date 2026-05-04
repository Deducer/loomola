# Speaker Recognition v1 — Calendar/Attendee match — Implementation Plan

**Date:** 2026-05-04
**Spec:** [`docs/superpowers/specs/2026-05-04-speaker-recognition-design.md`](../specs/2026-05-04-speaker-recognition-design.md) (Path B)
**Status:** Ready to execute
**Style:** TDD-flavoured. Single PR.

12 steps in 5 phases. Roughly mirrors the folder-suggestion shape so we're walking a paved road. Phase 1 (schema) unblocks Phase 2 (matcher). Phases 3 (worker), 4 (API + UI) are sequential.

---

## Phase 1 — Schema (~20 min)

### 1. Migration `0020_speaker_suggestion.sql`

- **File:** new `drizzle/0020_speaker_suggestion.sql`.
- **Goal:**
  - `ALTER TABLE speaker_assignments ADD COLUMN is_suggestion boolean NOT NULL DEFAULT false`.
  - `ADD COLUMN suggested_at timestamptz`.
  - `ADD COLUMN dismissed_at timestamptz`.
  - `ALTER TABLE people ADD COLUMN is_self boolean NOT NULL DEFAULT false`.
  - Partial unique index `people_owner_self_unique` on `(owner_id) WHERE is_self = true` (at most one self-Person per owner).
- **Acceptance:** runs cleanly via `scripts/migrate.ts`; existing rows unaffected.

### 2. Update `_journal.json` + Drizzle schema

- **Files:** `drizzle/meta/_journal.json` (idx 20), `src/db/schema.ts`.
- **Acceptance:** `npm run typecheck` clean.

### 3. Test fixture sync

- **File:** `tests/unit/export-bundle.test.ts` likely needs new fields on its `Recording` shape — same pattern as the folder-suggestion fix.
- **Acceptance:** all existing tests still pass.

---

## Phase 2 — Matcher (pure logic, ~1.5 hours)

### 4. Self-detection by total speech

- **File:** new `src/lib/speaker-suggestion/detect-self.ts`.
- **Goal:** pure function `detectSelfSpeakerIdx(words: WordTimestamp[]): number | null`. Sums total speech-seconds per speaker_idx, returns the index with the most speech, or `null` if no speakers had measurable speech or there's a tie within 5 %.
- **Tests:** `tests/unit/speaker-suggestion-self.test.ts`:
  - Single dominant speaker → returns that index.
  - Tie within 5 % → returns null.
  - No speaker info on words → returns null.
  - Speakers swap dominance with > 5 % margin → returns the actual leader.
  - Realistic 1:1 word stream → returns the host idx.

### 5. Attendee parsing

- **File:** new `src/lib/speaker-suggestion/parse-attendees.ts`.
- **Goal:** pure function `parseAttendees(raw: unknown): Array<{ email: string | null; displayName: string | null }>`. Handles the JSONB shape used by the Chrome extension and the desktop app's meeting detector. Skips empty / self-only entries.
- **Tests:** `tests/unit/parse-attendees.test.ts` — variety of shapes (string, object with name, object with email, mixed).

### 6. Person fuzzy-match

- **File:** new `src/lib/speaker-suggestion/match-person.ts`.
- **Goal:** pure function `matchPerson({ candidates, attendee })` → `{ personId, confidence: 'high' | 'medium' | 'none', reason }`:
  - High confidence: case-insensitive email exact match.
  - Medium confidence: token-set overlap of the attendee display name vs. existing person display name (≥ 60 % token overlap, no inflection).
  - None: no match → caller can suggest creating a new Person.
- **Tests:** `tests/unit/match-person.test.ts` — exact-email, name-token-overlap, none, accent-insensitive, etc.

### 7. The "compose suggestion set" function

- **File:** new `src/lib/speaker-suggestion/compose.ts`.
- **Goal:** pure function `composeSpeakerSuggestions({ words, attendees, people, selfPersonId })`:
  - Detect self speaker_idx (from step 4).
  - For each non-self speaker_idx, take the attendees in order (we have N speakers - 1 attendees in the 1:1 case, or fewer). Match each to a Person via step 6.
  - Returns `Array<{ speakerIdx, personId | null, suggestedNewPerson?: { name, email }, confidence }>`.
  - Skips entirely (returns []) if: no self-Person, or attendee count doesn't match speaker count - 1, or speaker count < 2.
- **Tests:** `tests/unit/compose-speaker-suggestions.test.ts`:
  - Happy path: 2 speakers, 1 known attendee, self-Person set → 1 suggestion.
  - 3 speakers, 2 attendees, both match → 2 suggestions.
  - 3 speakers, 1 attendee → no suggestions (count mismatch — Path B doesn't guess).
  - No attendees → no suggestions.
  - No self-Person → no suggestions.
  - Unknown attendee email → suggestedNewPerson populated.

---

## Phase 3 — pg-boss worker (~1 hour)

### 8. New job `suggest_speakers`

- **File:** new `src/lib/queue/jobs/suggest-speakers.ts`.
- **Goal:** `runSuggestSpeakersJob({ mediaObjectId })`:
  - Load: `media_objects.attendees`, transcript `wordTimestamps`, owner's `people` (incl. `is_self`).
  - If: no transcript yet, no attendees, no self-Person, or speaker_assignments already exist for this recording → no-op (log line).
  - Compose suggestions via `composeSpeakerSuggestions`.
  - For each suggestion: INSERT into `speaker_assignments` with `is_suggestion = true`, `suggested_at = now()`. ON CONFLICT (media_object_id, speaker_idx) DO NOTHING — protects against re-runs.
- **Tests:** `tests/unit/suggest-speakers-job.test.ts` — verify each early return + happy path with mocked queries.

### 9. Queue registration + enqueue wiring

- **Files:** `src/lib/queue/boss.ts` (register `SUGGEST_SPEAKERS_JOB` queue + worker), `src/lib/queue/jobs/generate-title-summary.ts` (enqueue at end, best-effort try/catch).
- **Acceptance:** `npm run dev` boots without errors. The new queue appears in pg-boss's `job` table on first send.

---

## Phase 4 — API + UI (~3 hours)

### 10. Accept / dismiss endpoints

- **Files:**
  - new `src/app/api/recordings/[id]/speaker-suggestions/accept/route.ts` (POST `{ speakerIdx, personId? , createPerson?: { name, email } }`)
  - new `src/app/api/recordings/[id]/speaker-suggestions/dismiss/route.ts` (POST `{ speakerIdx }`)
- **Behavior:**
  - **Accept:** auth + ownership; if `createPerson` is set, INSERT a new `people` row first; UPDATE the `speaker_assignments` row to `is_suggestion = false`, `person_id = ?` (overwrite if user picked a different Person from the popover); return updated row + person info for toast.
  - **Dismiss:** auth + ownership; UPDATE `is_suggestion` to false, `dismissed_at = now()`, `person_id = NULL` (clear the bad guess); idempotent.
- **Tests:** `tests/unit/speaker-suggestion-api.test.ts` — auth, ownership, create-new-person flow, double-accept idempotency, race (suggestion already cleared → 409).

### 11. Self-Person bootstrap

- **Files:** edit `src/app/people/page.tsx` and/or `src/components/people/people-manager.tsx`.
- **Goal:** if the user has no `is_self = true` row, show a one-time banner: "Mark yourself in your contacts so future recordings can identify you" → button creates a Person row with email pre-filled from the auth user, `is_self = true`. Hides after acknowledged.
- **Acceptance:** opening `/people` for the first time after this feature ships shows the prompt. Subsequent visits don't.

### 12. Transcript pill UI

- **File:** edit `src/components/viewer/transcript-panel.tsx`.
- **Goal:** when a `speaker_assignments` row has `is_suggestion = true`, the speaker label in the transcript renders with a small "Suggested" indicator and tap-to-confirm popover (✓ / ✗ / pick different person). Reuses existing assignment popover infrastructure.
- **Implementation note:** keep the pill component small (~80 LOC) and patterned after `<FolderSuggestionPill />` so future agents recognize the shape. Optimistic update + sonner toast on accept.
- **Tests:** manual smoke; if the existing transcript-panel has unit tests, extend them; otherwise rely on hardware smoke.

---

## Phase 5 — Verification (~30 min)

### 13. Manual smoke (Ian)

- Open `/people` → create a self-Person via the new bootstrap banner.
- Manually label your last call's two speakers (so the system has at least one Person known by both name and email, plus the self-Person).
- Record a fresh 1:1 audio note via the desktop app. Wait for AI processing.
- Open the note → transcript should show your name + the other person's name as suggestions on Speaker 0 / Speaker 1.
- Click ✓ on each → toast appears, labels confirm.
- Have a second call with the same person. Open note → labels suggested again automatically.

### 14. Doc + roadmap updates

- **Files:** `CLAUDE.md`, `AGENTS.md`, `ROADMAP.md`.
- **Goal:** add G-M13 (or whatever the next number is) to Stage 2 status table; document the `is_self` column convention; note Path C as deferred follow-up.

---

## Build notes for the next agent

- **Reuse the folder-suggestion pattern.** This milestone is intentionally shaped like the folder-suggestion one — same job-after-AI shape, same suggestion-row pattern, same confirm-pill UX, same sonner toast. Future agents should pattern-match.
- **The pure logic is the heart of the work.** Steps 4-7 (`detect-self`, `parse-attendees`, `match-person`, `compose`) are entirely pure and tested in isolation. The worker (step 8) is a thin DB orchestrator. Don't sneak business logic into the worker.
- **`is_self` is the right primitive.** Don't try to detect "the user" from auth context inside the worker — explicitly mark which Person row is the user's self.
- **Path C builds on this.** When voice biometrics ship, the same `speaker_suggestions` rows + UX get reused. Path C just adds another way to *generate* the suggestions, alongside the calendar-based generator.
- **The pre-existing `tests/unit/ai-schemas.test.ts > rejects negative timestamps` failure is unrelated.** Don't touch it.

---

## Out of scope (push to Path C / follow-up)

- Voice embeddings.
- Multi-speaker meetings (3+ attendees with 3+ speakers — both Path B's count check skips this).
- Suggestion of speakers not in any attendee list.
- Bulk re-suggestion across past recordings.
- Realtime appearance of suggestions on the dashboard (same answer as folder suggestion: appears on next page load until we add Realtime client wiring).
- Telemetry on accept rate.
