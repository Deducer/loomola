# Multi-Folder Note Assignments — Granola-parity filing

**Author:** Claude Opus 4.7
**Date:** 2026-05-06
**Status:** Spec — not yet planned or built
**Driving feedback:** Ian, 2026-05-06 — *"You can actually assign it to certain folders with a check on, check off, check mark system. So it can be in multiple folders at once or none at all."*

---

## Why this milestone

The current data model has a single `media_objects.folder_id` column — a note (or recording) lives in exactly one folder, or none. That's how Loom dashboards have always worked here, and how Granola's predecessors did. But Granola itself shipped a multi-folder model, and once you've used it, single-folder feels coarse:

- Some notes belong in *both* a project folder ("Vayu Labs") and a calendar folder ("Q2 OKRs"). With single-folder you have to pick one and lose retrievability through the other.
- The "Unfiled" inbox stays large because filing forces a commitment. Multi-folder lets users tag liberally — file a note into both *and* leave it discoverable in Recent.
- It matches the mental model of meeting notes: a meeting doesn't belong to *one* tag, it belongs to a set.

The desktop's new Granola-style folder pill (shipped in `ec87d31`) lays the visible surface — pill on hover, picker popover with a checkmark on the current folder. The picker today is single-select because the schema is. This spec is the schema migration + query rewrites + UI evolution that turns those checkmarks into real checkboxes.

---

## Goals

- A note can be in 0, 1, or N folders simultaneously. "0 folders" is the canonical "Unfiled" state.
- The desktop's folder picker becomes multi-select: tapping a row toggles assignment without dismissing the picker, like Granola.
- The web dashboard sidebar's folder filter still works ("show me only notes in folder X"); a note appearing in multiple folders shows up under each.
- Existing `folder_id` data migrates losslessly: every `media_objects` row with a non-null `folder_id` becomes a single-row assignment in the new join table, then we drop the legacy column.
- The AI folder-suggestion flow (`folder_suggestion`) keeps working: it still suggests *one* folder at a time, the user can accept it (which adds an assignment) or dismiss it.
- Optimistic-update semantics on the desktop are preserved — UI updates immediately, server is the eventually-consistent source of truth.

---

## Non-goals (explicit fence)

- **No nested folder hierarchies become smarter.** `folders.parent_id` already exists; multi-folder doesn't change how parent/child folders behave.
- **No tags on top of folders.** Tags would be the natural next iteration but they're a different product slice and a different schema.
- **No per-folder ordering of notes.** Notes are still globally ordered by `created_at desc`; there's no "manually sorted within a folder" concept.
- **No bulk re-filing UI in this milestone.** The dashboard's bulk-select bar (G-M14) keeps single-folder semantics for v1 — pick one folder for all selected. Multi-folder bulk apply is a follow-up.
- **No backwards compatibility with `media_objects.folder_id` after cutover.** We migrate the data, drop the column, don't keep it as a "primary folder" denormalization.
- **No public API breaking changes for non-desktop callers** — the existing `PATCH /api/recordings/:id/folder { folderId }` endpoint stays alive and translates "set folder" to "replace all assignments with a single one."

---

## Schema

### New table

```sql
CREATE TABLE media_folder_assignments (
  media_object_id uuid NOT NULL REFERENCES media_objects(id) ON DELETE CASCADE,
  folder_id       uuid NOT NULL REFERENCES folders(id)       ON DELETE CASCADE,
  owner_id        uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (media_object_id, folder_id)
);

CREATE INDEX media_folder_assignments_folder_idx
  ON media_folder_assignments (folder_id, created_at DESC);

CREATE INDEX media_folder_assignments_owner_media_idx
  ON media_folder_assignments (owner_id, media_object_id);

-- RLS: owner can read/write their own assignments only.
ALTER TABLE media_folder_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY mfa_owner_all ON media_folder_assignments
  FOR ALL USING (owner_id = auth.uid())
           WITH CHECK (owner_id = auth.uid());
```

`owner_id` is denormalized from `media_objects.owner_id` so RLS can filter without joining.

### Drop

```sql
ALTER TABLE media_objects DROP COLUMN folder_id;
```

After backfill + cutover. See *Migration phases* below.

### What about `media_objects.suggested_folder_id`?

That column stays — it's a single-folder hint from the AI suggestion job and the accept-flow inserts into `media_folder_assignments`. The `dismissed_at` and `suggested_at` columns remain unchanged.

---

## API surface

### Existing — unchanged behavior

- `GET /api/folders` — list user's folders. Same as today.
- `POST /api/folders` — create folder.
- `PATCH /api/folders/:id` — rename / re-parent.
- `DELETE /api/folders/:id` — delete folder. Existing cascade now wipes assignments.

### Existing — semantic update

- `PATCH /api/recordings/:id/folder { folderId: string | null }` — *backwards compat shim.* Replaces the recording's set of assignments with the single one passed (or empty if `null`). Used by the legacy single-folder flows on the web dashboard until they migrate to the new endpoints below.

### New endpoints

```
POST   /api/recordings/:id/folders     { folderId }   → 201 (no body)
DELETE /api/recordings/:id/folders/:folderId           → 204
GET    /api/recordings/:id/folders                     → { folders: [{ id, name }] }
```

Idempotent: re-POSTing an existing assignment is a 200 with no error. The DELETE on a missing assignment is a 200.

### Recent route changes

`/api/recordings/recent` currently returns `folderId` + `folderName` — single. Replace with `folders: [{ id, name }]` per item. The desktop's `RecentRecordingDTO` adopts the array shape.

---

## Migration phases

We can't atomically swap a column to a join table while web traffic is live. Three phases:

### Phase 1 — Dual-write (one deploy)

- Create `media_folder_assignments` table.
- Backfill: `INSERT INTO media_folder_assignments (media_object_id, folder_id, owner_id) SELECT id, folder_id, owner_id FROM media_objects WHERE folder_id IS NOT NULL`.
- All write paths now write to BOTH `media_objects.folder_id` (legacy) AND `media_folder_assignments` (new). Read paths still read from `folder_id`.
- New `POST /folders` and `DELETE /folders/:id` endpoints exist and write only to the new table (since they represent ops the legacy column can't model).
- Desktop continues sending `PATCH /folder { folderId }` — works as before.

### Phase 2 — Read flip (one deploy)

- All read paths switch to `media_folder_assignments`. The legacy `folder_id` column is still being written but no longer read.
- Recent route returns `folders: [...]`. Desktop ships a release that consumes the array shape.
- Dashboard sidebar filter switches to the join table.
- Web's bulk-move + drag-and-drop continue to write the legacy column too — so a rollback is still possible.

### Phase 3 — Drop the column (one deploy, after a soak period)

- Stop writing `media_objects.folder_id`.
- `ALTER TABLE media_objects DROP COLUMN folder_id`.
- Remove all references from queries.

Soak between phases 2 and 3 should be at least one week of normal usage so we catch any read paths we missed.

---

## Web dashboard UI changes

### Folder filter sidebar

Currently the sidebar shows `[All recordings] [Unfiled] [Folder A] [Folder B] ...`. Selecting "Folder A" filters to `folder_id = A`. After migration: filters to `EXISTS (SELECT 1 FROM media_folder_assignments WHERE media_object_id = m.id AND folder_id = A)`. A note in both A and B shows under each.

### Card folder pill

Today: shows the (single) folder name on each dashboard card. After: shows up to two folder pills with a "+N more" suffix when there are 3+ assignments. Hover the +N → tooltip with the full list.

### Move flow

Today's Edit Card → Move dropdown is single-select. New version is multi-select with checkboxes. The "Move" button label becomes "File" since we're not moving any more.

### Drag-and-drop

Currently dragging a card onto a folder *moves* it. After: dragging *adds* to that folder, doesn't remove from existing assignments. Holding ⌘ during drop opt-in to "move" semantics (clear other assignments). This matches Finder semantics.

### Bulk actions bar

Defer multi-folder for bulk in v1 (see non-goal). Bulk move continues to mean "replace all selected notes' folder sets with this one folder."

---

## Desktop UI changes

### Folder picker popover

The single-select popover shipped today gets a small but mechanically meaningful change:

- Each row shows a checkbox at the right (today: a checkmark on the active row only).
- Clicking a row toggles the assignment via `POST /folders` or `DELETE /folders/:folderId` — popover stays open.
- A header gets a subtitle "Filed in 2 folders" (or "Unfiled") that updates live.

### Recent row pill

Shows the first assigned folder's name with "+N" suffix when there are more — e.g. `📁 Vayu Labs +2`. Hover → tooltip lists all folders. The chevron still opens the picker.

### Optimistic update logic

`RecentRecordingsService.assignFolder` becomes `addFolder(recordingId, folderId)` and `removeFolder(recordingId, folderId)`. Optimistic update mutates the recording's `folders` array; failure reverts.

---

## Edge cases

- **Note in 0 folders.** Canonical "Unfiled" state. The Unfiled sidebar filter is `NOT EXISTS (SELECT 1 FROM media_folder_assignments WHERE media_object_id = m.id)`.
- **Folder deleted while a note is in it.** ON DELETE CASCADE on the FK takes care of it. Note silently loses that assignment. If it loses its last assignment it falls back to "Unfiled" — no special-casing needed.
- **Note deleted while in folders.** ON DELETE CASCADE wipes assignments.
- **AI suggestion accept-flow.** `media_objects.suggested_folder_id` → user clicks ✓ → insert into `media_folder_assignments`. If the same folder is already assigned, the insert is idempotent (no-op due to PK conflict; route catches and 200s).
- **AI suggestion dismissal.** Unchanged. `media_objects.suggested_folder_dismissed_at` is set; the suggestion never reappears for that note.
- **Concurrent assignments from two devices.** Idempotent endpoints + composite PK make double-add and double-remove safe.
- **Search by folder.** `search.ts` queries that filter by `folder_id` need to become `WHERE EXISTS (... media_folder_assignments ...)`. Touch list is small but real.

---

## Effort estimate

- **Phase 1 (dual-write):** ~3 hours. New table + RLS + backfill SQL, dual-write in `moveRecordingToFolder` and the suggested-folder accept route, add the new POST/DELETE/GET endpoints, no UI changes.
- **Phase 2 (read flip):** ~6 hours. Rewrite read paths in `listRecordings`, `search.ts`, dashboard sidebar query, the recent route. Update the web folder pill UI for multi-folder display + drag-and-drop semantics. Update desktop folder picker to multi-select with checkboxes. Update Recent row pill to handle multiple folders. Ship a desktop release with the new array DTO shape.
- **Phase 3 (cleanup):** ~1 hour. Drop column, remove references.

Total: ~10 hours of focused work + a one-week soak between phase 2 and 3.

---

## Open questions

- **Folder ordering on a multi-folder note.** When a note has 3 folders, which one shows first in the pill? Most-recently-assigned? Alphabetical? Granola seems alphabetical; that's the simplest answer.
- **Desktop offline write queue.** If the user toggles a folder while offline, the optimistic UI applies but the server call fails. Today's revert behavior is fine for one-off failures; for offline we'd want a write queue. Probably out of scope.
- **Backwards-compat shim retirement.** The `PATCH /folder { folderId }` route should keep working for at least a few weeks past phase 2 in case some integration we've forgotten about uses it. When can we drop it?

---

## What this enables next

- **Tags as a sibling concept.** Once filing is a many-to-many relationship, adding free-form tags is the same shape with a different join table. Reusable picker UI.
- **Smart folders.** "All notes from people on this team" / "All meetings in the last 7 days" can be defined as virtual folders that a note "belongs to" via predicate matching. The view layer doesn't care.
- **Shared folder spaces (much later).** When multi-user lands, a folder owned by another user that's been shared with you is just another assignment row pointing at a different `owner_id`. The model already accommodates it.
