# AI-Suggested Folder Assignment ("Granola pill")

**Author:** Claude Opus 4.7
**Date:** 2026-05-04
**Status:** Spec'd, ready to plan + build
**Related plan:** [`docs/superpowers/plans/2026-05-04-folder-suggestion.md`](../plans/2026-05-04-folder-suggestion.md)

---

## Why this milestone

Granola has a small but high-value UX moment: when a new note finishes processing, if the user hasn't assigned a folder, an inline pill appears on the dashboard card showing a suggested folder + ✓ / ✗. One click → moved + a bottom-right toast confirms. This is one of those features that disappears when you don't have it (you forget; notes pile up unfiled) and feels invisible-but-essential when you do. We want the same.

Our existing infra already has most of what's needed:

- `media_objects` rows have a nullable `folder_id` (Stage 1.5b).
- `folders` table exists with names and a hierarchy.
- `pg-boss` queue infra is mature.
- `generate_title_summary` job already runs after every transcript completes (Loom + Granola).
- `summary_embeddings` are written for every note (G-M8).
- Supabase Realtime is already publishing `media_objects` changes (G-M1) so the dashboard reacts live.
- `sonner` is already installed and a `<Toaster position="bottom-right" />` is mounted in the root layout — bottom-right toasts are a `toast.success("...")` away.

What's missing: an AI classifier that picks the best folder given a new note + the user's folder library, persistence for the suggestion + dismissal, the inline UI pill, and the wire-up.

## Goals

- After a Loom recording or a Granola audio note finishes its AI title + summary pass, if the user hasn't picked a folder and they have at least one folder, an AI suggestion appears on the dashboard card automatically.
- Suggestions are shown only when the model is **highly confident** that a single existing folder is the right home — false positives feel worse than no suggestion at all.
- One click on ✓ moves the note into the folder with an optimistic UI update + a `toast.success("Added '<title>' to '<folder>'")` bottom-right.
- One click on ✗ permanently dismisses the suggestion for that note. The pill never reappears for the same note unless the user explicitly regenerates AI notes.
- The feature works identically for video recordings (Loom) and audio notes (Granola). Schema is polymorphic; UI components live in shared `dashboard/` files.
- No measurable latency added to existing flows — the classifier is a separate pg-boss job that runs after the title/summary write, not inline.

## Non-goals (explicit fence)

- **No multi-folder suggestions.** Granola shows one folder. We show one folder.
- **No "create new folder" suggestion.** Only matches existing folders. Creating new folders by AI is a different product slice.
- **No re-suggestion after dismissal.** The X button is sticky for that note. Only a manual AI regen creates a new suggestion opportunity.
- **No folder description field.** v1 derives folder semantics from member note titles. Adding a `description` column to `folders` is a follow-up if classification quality is poor.
- **No bulk-suggestions for unfoldered backlog.** Only newly-processed notes get suggestions. Backfilling old notes is a follow-up.
- **No suggestion confidence display in the UI.** The model's confidence is gating; the user only sees the pill when we're sure. We don't show "low / medium / high" labels.
- **No analytics or telemetry on accept/dismiss.** Single-user product; not yet justified.

---

## How it flows

```
┌───────────────────────────────────────────────────────────────┐
│ Recording → upload → Deepgram → transcript persisted          │
│                                                                │
│         enqueueAiJobs() fans out 3 jobs:                       │
│           • generate_title_summary  ◄── new behavior here      │
│           • generate_chapters                                  │
│           • extract_action_items                               │
│                                                                │
│ generate_title_summary completes:                              │
│   • writes title + summary to ai_outputs (existing)            │
│   • IF folderId IS NULL AND user has ≥ 1 folder:               │
│       enqueue suggest_folder job                               │
│                                                                │
│ suggest_folder job:                                            │
│   • Loads new note + user's folder list + samples              │
│   • Calls Haiku 4.5 with classification prompt                 │
│   • Parses Zod-typed response                                  │
│   • If confidence === 'high' AND folderId is in user's list:   │
│       UPDATE media_objects                                     │
│         SET suggested_folder_id = ?,                           │
│             suggested_folder_at = now()                        │
│   • Else: no-op                                                │
│                                                                │
│ Supabase Realtime push lands on the dashboard.                 │
│ Card re-renders; FolderSuggestionPill appears.                 │
│                                                                │
│ User clicks ✓ → POST /api/recordings/:id/suggested-folder/    │
│   accept → moves into folder, clears suggestion, toast fires.  │
│ User clicks ✗ → POST .../dismiss → marks dismissed, no toast.  │
└───────────────────────────────────────────────────────────────┘
```

## The classifier

### Why an LLM, not embedding similarity

The repo already produces `summary_embeddings`, so cosine-similarity against folder centroids is "free." It's the wrong tool here.

User folders are project-coded names (`American Buddha`, `Vayu Labs`, `Project Win`, `Credit Builder Card`), not topical clusters. A folder might contain notes about animation, AI workflows, character design, scheduling, finance — bound only by "this is the American Buddha project." An embedding centroid for that folder doesn't reliably separate from another project folder containing similar topical breadth.

A small LLM call reasons across content + title + project semantics + "the kind of note that goes into this folder" the way a human does. Granola's behavior strongly suggests they do this too.

### Why Haiku 4.5

- Classification task. Sonnet would burn budget for no quality gain.
- Sub-1.5s end-to-end is reasonable; we want the pill to appear within a few seconds of the title/summary appearing.
- Cost: ~$0.005 per call (1-2K input tokens, <500 output tokens at $0.80 / $4 per Mtok).

If the user provisioned only an OpenRouter fallback or only Anthropic, both work — `getLlm` and `getFallbackLlm` already abstract this. We pass an explicit `modelId` of `claude-haiku-4-5-20251001` rather than the default `LLM_MODEL` so the existing title/summary call (Sonnet) isn't downgraded.

### Prompt shape

System / instruction:

> You categorize meeting notes into the user's existing folders. Pick the single folder that best fits, or `null` if no folder is clearly the right home. Only return high confidence when you're sure — false matches are worse than no match. Respond with JSON matching the supplied schema.

User content:

```
NEW NOTE
Title: <title>
Source: <meeting source hint, e.g. "Google Meet — Acme call">
Attendees: <list, if any>
Summary: <AI summary, ≤ 1500 chars>
Transcript excerpt: <first 500 chars + last 500 chars>

USER'S FOLDERS
1. <folderId> — <folderName>
   Recent notes: "<title 1>", "<title 2>", "<title 3>", "<title 4>", "<title 5>"
2. <folderId> — <folderName>
   Recent notes: ...
```

The folder list is sorted by most-recently-modified first (the active folders the user is using are the relevant ones). Up to 12 folders are passed; if the user has more, we trim to the most-recent 12.

### Response schema

```ts
const folderSuggestionSchema = z.object({
  folderId: z.string().uuid().nullable(),
  confidence: z.enum(["low", "medium", "high"]),
  reason: z.string().min(0).max(200),
});
```

`reason` is captured for debugging in the worker logs (and a future "Why this folder?" tooltip on hover) but not surfaced to the UI in v1.

### Acceptance gating

Server-side, before persisting:

1. `confidence === "high"` (strict — no medium-or-better).
2. `folderId !== null`.
3. `folderId` belongs to the user's actual folder list (LLM hallucination defense).

Anything failing these → no-op, no row update.

---

## Storage

### `media_objects` schema delta

Three nullable columns (additive migration `0019_folder_suggestion.sql`):

```sql
ALTER TABLE media_objects
  ADD COLUMN suggested_folder_id uuid REFERENCES folders(id) ON DELETE SET NULL,
  ADD COLUMN suggested_folder_at timestamptz,
  ADD COLUMN suggested_folder_dismissed_at timestamptz;
```

Why three columns and not one:

- `suggested_folder_id` is the live state — clear it when the user accepts (the suggestion has been applied) or rejects (we want to know the user dismissed; see next column).
- `suggested_folder_at` is informational (when the suggestion was made; useful for "stale" logic later, not used in v1).
- `suggested_folder_dismissed_at` is the dismissal lock. Persisting it prevents the worker from re-suggesting on a regen-AI-notes cycle if the user already said no. (Wait — we did say re-suggest after regen *is* OK. The lock applies only to *the same generation cycle*; the regen path explicitly clears `suggested_folder_dismissed_at` so the user gets another shot. See "Regeneration behavior" below.)

`folders` is unchanged. ON DELETE SET NULL: if the user deletes the suggested folder before accepting, the suggestion silently vanishes.

### Realtime publication

The existing publication on `media_objects` (added in G-M1) already covers these new columns. Dashboards that subscribe to row changes will automatically receive updates. No publication change needed.

### RLS

`media_objects` already has owner-scoped RLS. The new columns are within the same row, same policy. No new policy needed.

---

## API

Two endpoints. Both authenticated via `requireAuth`. Both verify ownership (existing pattern).

### `POST /api/recordings/[id]/suggested-folder/accept`

Body: `{}`

Behavior:
- Verify the recording belongs to the user.
- Verify a `suggested_folder_id` is currently set.
- In a single atomic UPDATE: set `folder_id = suggested_folder_id`, then null out `suggested_folder_id` and `suggested_folder_at`.
- Return `{ folderId, folderName }` so the toast can include the folder name without an extra round trip.

### `POST /api/recordings/[id]/suggested-folder/dismiss`

Body: `{}`

Behavior:
- Verify the recording belongs to the user.
- UPDATE: null out `suggested_folder_id` and set `suggested_folder_dismissed_at = now()`.
- Return `{ ok: true }`.

Why named routes instead of generic PATCH: each one is a single user gesture with a specific UI response, and naming them keeps the optimistic update + toast wiring on the client side trivial. PATCH /api/notes/[id] already exists for general updates and we keep it as-is.

### Regeneration behavior

When the user clicks "Regenerate notes" (Stage 2 G-M9 already shipped this for audio notes) the existing `enqueueAiJobs` runs again. That re-runs `generate_title_summary` which then re-enqueues `suggest_folder`. Inside the suggest_folder job, *before* deciding to skip, we check the dismissal-stickiness rule: dismissals from a *previous* generation should not block a fresh one.

Implementation: `suggest_folder` checks `folder_id IS NULL AND suggested_folder_id IS NULL`. If `suggested_folder_dismissed_at` is set, we additionally check whether `ai_outputs.updated_at > suggested_folder_dismissed_at` — i.e. the AI was regenerated *after* the dismissal. If so, clear `suggested_folder_dismissed_at` and proceed. If not, skip (the dismissal still stands).

This is a hot-path SQL check; cheap.

---

## UI

### `<FolderSuggestionPill />`

New component at `src/components/dashboard/folder-suggestion-pill.tsx`.

Props:

```ts
{
  recordingId: string;
  recordingTitle: string;
  suggestedFolderId: string;
  suggestedFolderName: string;
  /** Called after a successful accept/dismiss so the parent can update its
   *  in-memory list optimistically without a refetch. */
  onAccepted?: () => void;
  onDismissed?: () => void;
}
```

Layout (matching Granola's screenshot — small inline pill, right-aligned within the card row):

```
┌───────────────────────────────────────────────┐
│ 📁 American Buddha   ✓   ✗                    │
└───────────────────────────────────────────────┘
   ↑ folder color or muted   ↑ green   ↑ red on hover
```

- Background: `bg-bg-subtle` rounded-full pill.
- Folder icon + name: `text-text-muted text-xs`.
- ✓ button: small icon button, green text, scales on press.
- ✗ button: small icon button, muted text, red on hover.
- 200ms fade-in on first appearance (when realtime delivers the suggestion to a card already on screen).
- 200ms slide-out on dismiss; immediate disappear on accept (the card itself moves).

Mobile: stacked under the title at <640px, same pill content.

### Where it appears

Both card components on the dashboard:

- `src/components/dashboard/recording-card.tsx` (videos, in the Recordings tab)
- `src/components/dashboard/notes-list.tsx` (audio notes, in the Notes tab)

Layout: the pill sits in the right-hand column of the card row, right-aligned, between the existing duration/timestamp and the hover-revealed action menu. When the pill is present, the existing right-side metadata (date, duration) shifts down or compacts — see the visual example in Granola's screenshot. We use a `flex` row with the pill in a wrapped slot.

The pill is **not** shown on the recording detail page (`/v/:slug`), the notes detail page (`/notes/:id`), or the edit console (`/recordings/:id/edit`). Granola only shows it on the dashboard. Matching that.

### Optimistic update

On ✓:
1. Immediately remove the pill from the local card state.
2. Move the card into the suggested folder in the dashboard's local state — i.e. if the dashboard is currently filtered to a folder ≠ the suggested one, the card slides out of view; if the filter is "All recordings" the card stays in place but the folder badge updates.
3. Fire `toast.success("Added '<truncated title>' to '<folder name>'")`.
4. Fire the API call. On failure: restore + `toast.error(...)`.

On ✗:
1. Immediately remove the pill.
2. Fire the API call. On failure: restore + silent (no error toast — dismissal isn't critical).

### Toast copy

Match Granola's copy exactly (it reads as muscle-memory): `Added "<title>" to <folder name>`. Title is truncated at 60 chars with `…`. Toast persists for the default sonner duration (~3s).

### Discovery affordance

In the Granola screenshot, the pill just *appears*. Same here: when the suggestion lands via Realtime, the pill appears with a 200ms fade-in. The user notices it on whatever card has new state. No banner, no global "X new suggestions" UI. Granola-faithful.

---

## Acceptance criteria

- A new audio note finishes its AI title/summary pass with `folder_id IS NULL` and the user has ≥ 1 folder → pill appears on the dashboard card within ~5s without a manual refresh.
- The same flow works for a Loom video recording.
- Clicking ✓ moves the note into the folder, the toast appears bottom-right, and the suggestion is cleared from the row.
- Clicking ✗ removes the pill; refreshing the page does not bring it back; regenerating AI notes *does* bring back a fresh suggestion opportunity.
- A new note where the user *already* has a folder set: no pill, no job, no LLM call.
- A new note where the user has *zero* folders: no pill, no job, no LLM call.
- Hallucinated folder IDs from the model are silently rejected (no row update, log line written).
- Low or medium confidence responses are silently rejected.
- The pill never appears on the share page, edit page, or note detail page.
- A folder deleted between suggestion-write and accept-click silently clears the suggestion (cascade-set-null).
- Smoke E2E (`npm run smoke`) still passes.
- Unit tests cover: prompt builder structure, schema parse, gating logic (confidence + ownership + hallucination defense), API ownership checks, dismissal-stickiness across regen.

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Haiku gives wrong-but-confident matches | User accepts a bad move; trust erodes | High confidence threshold; manual verification on first 5-10 notes; a single ⌘Z-style undo would be nice but is out of scope (the folder filter UI lets the user move it back manually) |
| Folder list trimming hides the right folder | User has >12 folders, the right one is older | Sort by most-recently-modified; 12 is enough for any practical case based on screenshot evidence (~10 folders) |
| Realtime subscription drops a message | Pill never appears for that recording | Page reload refetches state from DB; this is consistent with how every other realtime feature works in the app |
| User regenerates AI notes 100 times | 100 LLM classifier calls | Cheap (Haiku) but worth noting; if it becomes a real cost concern, debounce by checking that summary content actually changed |
| Pill clutters dense card layouts | Visual noise on cards with lots of metadata | Pill is small, right-aligned, and only present briefly — collapses on accept/dismiss |
| Two suggestions race (regen during a pending suggestion) | Two pills queued | The schema has one `suggested_folder_id` slot; the second write overwrites the first — not a problem, just a behavior to know |

## Open questions

- **Confidence threshold:** the user wants HIGH only for v1. We can tune to MEDIUM-or-better if HIGH proves too conservative after a week of use.
- **Manually-typed quick notes:** if the user types a note without a transcript (just hits the "Quick note" button), we don't have a transcript to classify on. The job should treat that as "no signal, skip" — `transcript` length below ~200 chars and an empty AI summary mean we don't run the classifier. Title alone is too thin a signal.

## Out of scope (push to follow-up)

- "Suggest a new folder" when no existing folder fits.
- Bulk-classification of the existing unfoldered backlog.
- Telemetry on suggestion accept rate.
- Folder `description` field as an explicit signal.
- "Why this folder?" tooltip on the pill (we capture `reason` server-side; surface it later if needed).
- Multi-folder suggestions.
- Confidence visual treatment ("medium" pill in different color).
- ⌘Z-style undo for accidental accepts.
