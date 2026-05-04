# AI-Suggested Folder Assignment — Implementation Plan

**Date:** 2026-05-04
**Spec:** [`docs/superpowers/specs/2026-05-04-folder-suggestion-design.md`](../specs/2026-05-04-folder-suggestion-design.md)
**Status:** Ready to execute
**Style:** TDD-flavoured. Single PR.

15 steps in 6 phases. Phase 1 (schema) unblocks Phase 2 (classifier). Phases 3 (API), 4 (worker), 5 (UI) can land in any order after Phases 1-2 are in.

---

## Phase 1 — Schema (~20 min)

### 1. Migration `0019_folder_suggestion.sql`

- **File:** new `drizzle/0019_folder_suggestion.sql`.
- **Goal:** add `suggested_folder_id` (uuid, FK ON DELETE SET NULL), `suggested_folder_at` (timestamptz), `suggested_folder_dismissed_at` (timestamptz) to `media_objects`. All nullable.
- **Acceptance:** runs cleanly via `scripts/migrate.ts`. Existing rows unaffected.

### 2. Update `_journal.json` + Drizzle schema

- **Files:** `drizzle/meta/_journal.json` (idx 19), `src/db/schema.ts` (extend `mediaObjects` table).
- **Acceptance:** `npm run typecheck` clean. New fields appear on the inferred type.

---

## Phase 2 — Classifier (~2 hours)

### 3. Schema for the LLM response

- **File:** `src/lib/ai/schemas.ts`.
- **Goal:** add `folderSuggestionSchema` (folderId nullable uuid, confidence enum low|medium|high, reason string ≤200 chars).
- **Tests:** `tests/unit/ai-schemas.test.ts` — accept/reject various shapes.

### 4. Folder library fingerprint builder

- **File:** new `src/lib/folder-suggestion/build-prompt.ts`.
- **Goal:** pure function `buildFolderSuggestionPrompt({ note, folders }) → string`. Deterministic. No I/O.
- **Inputs:**
  - `note: { title, summary, transcriptExcerpt, attendeeNames, sourceContextHint }` — all strings, can be empty.
  - `folders: Array<{ id, name, recentNoteTitles: string[] }>` — already trimmed to ≤12 by caller, sorted most-recently-modified first.
- **Output:** the structured prompt body documented in the spec § "Prompt shape".
- **Tests:** `tests/unit/folder-suggestion-prompt.test.ts`:
  - Snapshot-style test verifying prompt structure for a simple input.
  - Empty `folders` → still produces a parseable prompt (worker should skip before calling, but defense-in-depth).
  - Truncates summary to 1500 chars and transcript excerpt to 1000 chars (head + tail).
  - Properly escapes folder names containing newlines / quotes.

### 5. DB query for the worker's input

- **File:** new `src/db/queries/folder-suggestion.ts`.
- **Goal:** two helpers:
  - `getNoteForSuggestion(mediaObjectId)`: returns `{ ownerId, type, title, summary, transcriptExcerpt, attendeeNames, sourceContextHint, folderId, suggestedFolderDismissedAt, aiUpdatedAt }` — joins `media_objects`, `transcripts`, `ai_outputs`, optionally `notes`. One row.
  - `getCandidateFolders(ownerId)`: returns `Array<{ id, name, recentNoteTitles: string[] }>` — top 12 folders by `updated_at DESC`, with the most recent 5 note titles per folder. Single round-trip preferable; OK to issue 1+N queries if simpler.
- **Tests:** `tests/unit/folder-suggestion-queries.test.ts` is integration-flavored; if mocking the DB is too costly, leave the SQL untested at the unit level and rely on the smoke E2E.

### 6. Classifier wrapper

- **File:** new `src/lib/folder-suggestion/classify.ts`.
- **Goal:** `classifyFolder({ note, folders })` → `Promise<{ folderId: string | null, confidence, reason }>`. Internally calls `generateObjectWithFallback` with `folderSuggestionSchema`, the prompt from step 4, and an explicit Haiku model.
- **Note:** `getLlm()` returns the configured default (Sonnet for the rest of the pipeline). Add a small `getClassifierLlm()` helper that returns Haiku 4.5 by default but honors `LLM_CLASSIFIER_MODEL` env override, with the same Anthropic→OpenRouter fallback story.
- **Tests:** `tests/unit/folder-suggestion-classify.test.ts`:
  - Mock `generateObjectWithFallback`. Verify the prompt and schema flow through.
  - Verify low/medium confidence responses are *not* gated here — the worker (step 8) does the gating. The classifier returns the raw model response.

### 7. Server-side gating

- **File:** `src/lib/folder-suggestion/classify.ts`.
- **Goal:** export `acceptSuggestion(response, candidateFolderIds): { folderId } | null`. Returns the folderId only when:
  - `response.confidence === "high"`.
  - `response.folderId !== null`.
  - `response.folderId ∈ candidateFolderIds` (hallucination defense).
- **Tests:** in the same test file as step 6, parametrized over rejected and accepted cases.

---

## Phase 3 — pg-boss worker (~1.5 hours)

### 8. New job: `suggest_folder`

- **File:** new `src/lib/queue/jobs/suggest-folder.ts`.
- **Goal:** `runSuggestFolderJob({ mediaObjectId })`:
  1. Load `getNoteForSuggestion`. If `folderId` is already set → no-op (the user picked one between enqueue + run). If `suggestedFolderId` is already set → no-op (already suggested).
  2. Dismissal-stickiness check: if `suggestedFolderDismissedAt` is set and `aiUpdatedAt <= suggestedFolderDismissedAt` → no-op.
  3. If transcript excerpt < 200 chars and summary is empty → no-op (not enough signal).
  4. Load `getCandidateFolders`. If empty → no-op.
  5. Call `classifyFolder`. Then `acceptSuggestion`. If null → no-op (log a debug line with the rejected confidence + folderId).
  6. UPDATE `media_objects` SET `suggested_folder_id`, `suggested_folder_at = now()`, `suggested_folder_dismissed_at = NULL` (clear stale dismissal).
- **Tests:** `tests/unit/suggest-folder-job.test.ts`. Mock the queries + classifier. Verify each early-return path.

### 9. Queue registration

- **File:** `src/lib/queue/boss.ts` (or wherever jobs are registered).
- **Goal:** register the queue under `suggest_folder` with `expireInSeconds: 600` (10 min — a Haiku call is fast, but be generous).
- **Acceptance:** the dev server boots without errors; the queue appears in pg-boss's `job` table on first send.

### 10. Enqueue wiring

- **File:** `src/lib/queue/jobs/generate-title-summary.ts` (or `enqueue-processing.ts`).
- **Goal:** at the end of `runTitleSummaryJob`, after the title/summary write, enqueue `suggest_folder` for the same `mediaObjectId`. Best-effort: wrap in try/catch and log on failure (don't fail the whole job — title/summary is the user-visible payload).
- **Acceptance:** smoke a single recording end-to-end; see `[suggest-folder]` log line.

---

## Phase 4 — API routes (~1 hour)

### 11. Accept route

- **File:** new `src/app/api/recordings/[id]/suggested-folder/accept/route.ts`.
- **Method:** POST, body `{}`.
- **Behavior:** verify auth + ownership. In a single UPDATE-RETURNING: `SET folder_id = suggested_folder_id, suggested_folder_id = NULL, suggested_folder_at = NULL WHERE id = ? AND owner_id = ? AND suggested_folder_id IS NOT NULL RETURNING folder_id`. Look up the folder name from the returned id. Return `{ folderId, folderName }`.
- **Edge:** if the suggestion was already cleared (race with another tab), return 409 conflict so the client can refetch.
- **Tests:** `tests/unit/suggested-folder-accept.test.ts` — auth check, ownership, missing-suggestion 409 case, happy path.

### 12. Dismiss route

- **File:** new `src/app/api/recordings/[id]/suggested-folder/dismiss/route.ts`.
- **Method:** POST, body `{}`.
- **Behavior:** verify auth + ownership. UPDATE `SET suggested_folder_id = NULL, suggested_folder_at = NULL, suggested_folder_dismissed_at = now() WHERE id = ? AND owner_id = ?`. Return `{ ok: true }`. Idempotent — calling on an already-dismissed row is a no-op.
- **Tests:** in the same file as step 11 — auth + ownership + idempotency.

---

## Phase 5 — Dashboard UI (~3 hours)

### 13. `<FolderSuggestionPill />` component

- **File:** new `src/components/dashboard/folder-suggestion-pill.tsx`.
- **Goal:** the pill UI from spec § "Where it appears". Renders folder icon + name + ✓ + ✗. Calls accept/dismiss endpoints. Optimistic local state. Fade-in on mount.
- **Implementation note:** keep it small (~80 LOC). State machine: `idle → submitting-accept → done` and `idle → submitting-dismiss → done`. On submit failure, revert + `toast.error(...)`.
- **Tests:** `tests/unit/folder-suggestion-pill.test.tsx` if a React testing setup is available; otherwise rely on manual smoke. Check for the existence of test setup before adding the test.

### 14. Wire into the cards

- **Files:**
  - `src/components/dashboard/recording-card.tsx` — show pill when `recording.suggestedFolderId !== null && recording.folderId === null`.
  - `src/components/dashboard/notes-list.tsx` — same condition.
  - The dashboard query that hydrates these cards already returns the row; we need to pull the new columns into the select. Find the query (likely under `src/db/queries/` or invoked from `src/app/page.tsx`) and add `suggestedFolderId` + the joined folder name. Read first to confirm.
- **Goal:** card shows the pill in the right-aligned slot when applicable. On accept, the card optimistically updates its `folderId` (and clears the suggestion). On dismiss, just clears the suggestion.

### 15. Realtime hook

- **Files:** find the existing `media_objects` Realtime subscription on the dashboard (per G-M1, this should already exist for status changes). The new columns ride the same channel — just verify the local card-state updater includes them.
- **Goal:** when a `UPDATE media_objects ... suggested_folder_id` write hits, the dashboard re-renders the affected card with the pill. Without this, the user has to refresh.
- **Acceptance:** open a card on the dashboard, kick off a regen via the API in another tab — pill appears within ~3s without page refresh.

---

## Phase 6 — Verification (~30 min)

### 16. Smoke + manual

- **Run:** `npm run smoke`. The smoke covers the full Stage-1 pipeline; the new job is enqueued at the end of `generate_title_summary` so the smoke will exercise the enqueue. The smoke doesn't *yet* check that a suggestion gets persisted (that depends on having pre-existing folders in the test owner's account). Add a single assertion: after the smoke, query `media_objects.suggested_folder_id` for the smoke recording — it should be either NULL (the test owner has no folders) or a valid folder id. Don't fail the smoke; just log.

### 17. Manual smoke (Ian)

- Record a Loom video where the title/transcript clearly maps to one of your existing folders. Confirm the pill appears within a few seconds. Click ✓; confirm the toast and the move.
- Record an audio note where the transcript is generic / could plausibly fit several folders. Confirm no pill (low/medium confidence rejected).
- Click ✗ on a suggestion; confirm pill disappears and stays gone after refresh.
- Regenerate AI notes on a previously-dismissed note; confirm a fresh pill opportunity.

### 18. Update CLAUDE.md + AGENTS.md + ROADMAP.md

- **Files:** `CLAUDE.md`, `AGENTS.md`, `ROADMAP.md`.
- **Goal:** add the feature to the Stage-2 status table (or a new "Stage 2.1" section), document the new env var (`LLM_CLASSIFIER_MODEL`), add a CLAUDE.md note about the suggested-folder columns on `media_objects`.

---

## Build notes for the next agent

- **Order matters for Phase 1-2.** The schema must land before the classifier so the worker can compile against the new types.
- **Keep the classifier model swappable.** `getClassifierLlm()` reads `LLM_CLASSIFIER_MODEL` env (default `claude-haiku-4-5-20251001`). Don't hard-code the model id outside that helper.
- **Don't fail the title/summary job if suggest_folder enqueue fails.** Title/summary is the user-visible product; folder suggestion is enrichment. Wrap the enqueue in try/catch and log.
- **The "Quick note" button skips suggestions** when the transcript is < 200 chars and the summary is empty. That's not a feature flag; it's an inline check in the worker.
- **Pill UI lives only on the dashboard cards.** Don't add it to the share page, edit page, or note detail page. Granola's behavior is dashboard-only and matching it keeps the surface focused.
- **`sonner` is already wired** — just `import { toast } from "sonner"` and call `toast.success(...)`. The `<Toaster position="bottom-right">` is already mounted in `src/app/layout.tsx`.
- **Optimistic updates without a global state library.** The dashboard cards are server-rendered with client islands for interactive state. The pill component manages its own local "I've been clicked" state and the parent card listens to a callback to update its row. Don't pull in zustand or anything; the existing patterns in `recordings-grid.tsx` (which already does optimistic deletes/moves) are the precedent.
- **The pre-existing `tests/unit/ai-schemas.test.ts > rejects negative timestamps` failure is unrelated** — don't touch it.

## Out of scope (push to follow-up)

- Bulk-suggestion for the existing unfoldered backlog.
- "Suggest a new folder" when no existing folder fits.
- Folder `description` column as an explicit classification signal.
- Confidence visual treatment in the pill (medium vs high).
- Telemetry on accept rate.
- ⌘Z undo for accidental accepts.
