# Granola → Loomola Migration Tool (v1)

**Author:** Claude Opus 4.7
**Date:** 2026-05-06
**Status:** Spec'd, ready to plan + build
**Related plan:** *(to be written by the writing-plans skill after this spec is approved)*

---

## Why this milestone

Loomola is being prepared for an open-source release with a paid add-on bundle: a self-host walkthrough video plus a CLI migration tool that lets buyers move their existing Loom and/or Granola backlogs into a self-hosted Loomola. This spec covers **only the Granola side**; Loom is a separate spec to follow once Granola has been dogfooded against the author's real backlog.

The buyer audience is technical (they're going to provision Cloudflare R2, a VPS, Doppler, etc.) but is unlikely to be on Granola's Business tier — the official Granola API requires Business or Enterprise, so v1 must work against Granola's free/Pro tier using the local cache + reverse-engineered endpoints that the open-source community has been using for a year ([`getprobo/reverse-engineering-granola-api`](https://github.com/getprobo/reverse-engineering-granola-api), archived Feb 2026 in favor of the official API; [`wassimk/granary`](https://github.com/wassimk/granary)).

Loomola's existing schema is polymorphic-by-construction (`media_objects.type = 'video' | 'audio'`, polymorphic folders/transcripts/ai_outputs/people/speaker_assignments). The migration tool plugs into existing tables — only minor metadata columns are added.

## Goals

- A buyer (or the author) can run a single CLI on their Mac, paste an auth token, and have all their Granola notes show up in Loomola looking and behaving identically to natively-recorded notes.
- v1 is **lossless completionist** for the data Granola actually has: title, note body, AI summary, transcripts (cached + fetched-live), attendees → `people` rows, Granola Lists → folders, speaker attribution → `speaker_assignments`, original meeting date.
- Re-runs are idempotent under the **merge / fill-the-gaps** rule: existing fields are never overwritten, missing fields get filled in, no row is ever duplicated.
- The CLI is a polished single Mac binary (Bun-compiled, ad-hoc signed), distributable as part of the paid bundle.
- The same code path the author uses for dogfood is exactly what buyers run — no two-track development.

## Non-goals (explicit fence)

- **No Loom migration.** Separate spec. v1 lays the `import_source` slot for it.
- **No Granola action-item extraction.** Leave `ai_outputs.action_items=[]` on imports until we see what structured shape exists in real Granola data.
- **No re-running Loomola's `generate_title_summary` AI** on imports. We trust Granola's existing title + summary work. The only Loomola pg-boss job that fires is `suggest_folder`, and only on notes with no list assignment.
- **No audio import.** Granola does not record or store audio anywhere ([docs.granola.ai](https://docs.granola.ai/help-center/taking-notes/transcription)). Imported `media_objects` rows have `type='audio'` with all R2 keys null. This is structural, not a tooling gap.
- **No OAuth device-code flow** for the CLI. Paste-token (existing Supabase access token) is good enough for v1.
- **No new auth machinery on the server.** The import endpoint uses existing Supabase JWT validation.
- **No bulk/streaming import endpoints.** Per-note round-trip is fine; merge idempotency is the resume mechanism.
- **No Windows/Linux CLI builds.** Granola is Mac-only; revisit when Loom v1 lands.
- **No web UI for run monitoring.** `state.json` and the CLI's stdout suffice.
- **No name-collision auto-merge** between Granola Lists and existing user-created Loomola folders. They stay separate; user can consolidate manually.
- **No comments / share links / brand profiles** mapping. Granola has none of these.
- **No ongoing sync.** v1 is a one-shot snapshot; re-running fills gaps but doesn't track Granola-side deletions or edits.

---

## Architecture

```
┌─────────────────────────── User's Mac ───────────────────────────┐
│                                                                  │
│  ~/Library/Application Support/Granola/                          │
│    ├── cache-v4.json    ◄─── (read-only, snapshotted to /tmp)    │
│    └── supabase.json    ◄─── (read WorkOS access_token)          │
│                                                                  │
│           ▼                                                      │
│  ┌─────────────────────────────────────────────────┐             │
│  │  loomola-migrate (Bun-compiled binary)          │             │
│  │  ├─ extract: cache reader + Granola API client  │             │
│  │  ├─ transform: minimal — Granola-shape preserved│             │
│  │  └─ load: HTTP client → Loomola API             │             │
│  └─────────────────────────────────────────────────┘             │
│           │ HTTPS, Authorization: Bearer <paste-token>           │
└───────────│──────────────────────────────────────────────────────┘
            ▼
┌────────────────────── Loomola (loom.dissonance.cloud) ──────────────┐
│                                                                     │
│  POST /api/import/granola/note   ◄── new endpoint, single TXN       │
│    ├─ upserts media_objects, notes, ai_outputs, transcripts         │
│    ├─ upserts people (attendees), folders (lists)                   │
│    ├─ inserts speaker_assignments, media_folder_assignments         │
│    └─ queues `suggest_folder` for orphans                           │
│                                                                     │
│  GET  /settings/migration        ◄── new page                       │
│    ├─ install instructions                                          │
│    ├─ "Reveal access token" → Supabase session JWT                  │
│    └─ run command (copy-paste)                                      │
└─────────────────────────────────────────────────────────────────────┘
```

The CLI is a **near-passthrough** — it shapes a Granola payload that mirrors Granola's own data model, then POSTs one payload per note to the Loomola server. All translation into Loomola's schema — segment normalization, speaker indexing, attendee→person merge, list→folder dedup — lives inside the server-side route handler. The single exception is **ProseMirror → Markdown conversion**: the CLI converts the note body before sending, so the server never has to know about Granola's editor format. This keeps the CLI thin and means a future Loom CLI doesn't need to duplicate any mapping logic.

### Repo layout

Mirrors the existing `desktop/` precedent — sibling directory at repo root, self-contained, its own `package.json`.

```
migrate/
├── README.md                  # buyer-facing install + run instructions
├── package.json               # bun workspace, separate from root
├── tsconfig.json
├── scripts/
│   └── build.sh               # bun build --compile → loomola-migrate (Mach-O arm64)
├── src/
│   ├── cli.ts                 # entry, parses args, picks subcommand
│   ├── granola/
│   │   ├── auth.ts            # read supabase.json, refresh tokens
│   │   ├── cache-reader.ts    # parse cache-v4.json (with v3 fallback)
│   │   ├── api-client.ts      # WorkOS-auth'd fetch wrapper, rate-limited
│   │   └── types.ts           # Granola payload + cache shapes
│   ├── loomola/
│   │   ├── api-client.ts      # HTTP client with bearer token
│   │   └── types.ts           # mirrored from src/db/schema.ts
│   ├── transform/
│   │   └── prosemirror.ts     # ProseMirror JSON → Markdown (only client-side
│   │                          # translation — server shouldn't know ProseMirror)
│   ├── state/
│   │   └── run-state.ts       # ~/.loomola-migrate/state.json — atomic write
│   └── log.ts                 # structured logs + pretty terminal output
└── tests/
    ├── fixtures/
    │   └── sample-cache.json
    └── *.test.ts
```

**Dev loop:** `cd migrate && bun run src/cli.ts granola --token=$LOOMOLA_TOKEN` — no compile.
**Release loop:** `cd migrate && ./scripts/build.sh` → produces `loomola-migrate` binary, ad-hoc signed.

---

## Server-side changes

### Schema migration `0020_import_metadata.sql`

```sql
ALTER TABLE media_objects
  ADD COLUMN import_source TEXT,
  ADD COLUMN import_source_id TEXT,
  ADD CONSTRAINT media_objects_import_source_check
    CHECK (import_source IS NULL OR import_source IN ('loom', 'granola'));
CREATE UNIQUE INDEX media_objects_import_source_uniq
  ON media_objects (user_id, import_source, import_source_id)
  WHERE import_source IS NOT NULL;

ALTER TABLE people
  ADD COLUMN import_source TEXT,
  ADD COLUMN import_source_id TEXT;
CREATE UNIQUE INDEX people_import_source_uniq
  ON people (user_id, import_source, import_source_id)
  WHERE import_source IS NOT NULL;

ALTER TABLE folders
  ADD COLUMN import_source TEXT,
  ADD COLUMN import_source_id TEXT;
CREATE UNIQUE INDEX folders_import_source_uniq
  ON folders (user_id, import_source, import_source_id)
  WHERE import_source IS NOT NULL;
```

`transcripts.provider` is already free-form text — `'granola'` becomes a valid value with no schema change.

The `import_source` column on `media_objects` uses a CHECK constraint with `'loom'` already listed so the Loom-migration spec can drop in without an additional migration.

### New API endpoint: `POST /api/import/granola/note`

Single endpoint, single transaction per note. Body is Zod-validated. Gated by:
- `ENABLE_GRANOLA === 'true'` (returns 404 otherwise)
- Authenticated Supabase session (existing middleware — no new auth)

**Request body shape (`GranolaNoteImportPayload`):**

```ts
type GranolaNoteImportPayload = {
  granolaId: string;            // doc.id, → media_objects.import_source_id
  title: string;
  createdAt: string;            // ISO; → media_objects.recorded_at
  durationSeconds: number | null;
  notesBody: string;            // Markdown (CLI converts from ProseMirror)
  aiSummary: string;            // doc.summary, → ai_outputs.summary
  meetingUrl: string | null;
  attendees: Array<{
    granolaPersonId: string;    // → people.import_source_id
    name: string;
    email: string | null;
    isSelf: boolean;            // computed by CLI from /v2/get-me
  }>;
  lists: Array<{
    granolaListId: string;      // → folders.import_source_id
    name: string;
  }>;
  transcript: null | {
    segments: Array<{
      granolaPersonId: string | null;  // null = unknown speaker
      text: string;
      startMs: number;
      endMs: number;
    }>;
    fullText: string;          // joined for embeddings/search
  };
};
```

**Response:**
```ts
type GranolaNoteImportResult = {
  mediaObjectId: string;        // existing or newly-created
  action: 'created' | 'updated' | 'unchanged';
  warnings: string[];           // e.g., "transcript missing", "list 'X' renamed"
};
```

**Server-side write order (single transaction):**
1. Resolve `is_self` person: find existing `people WHERE user_id=? AND is_self=true`. If absent and any attendee has `isSelf=true`, the matching attendee will be created as is_self.
2. Upsert each attendee `people` row by `(user_id, 'granola', granolaPersonId)`. Merge fields with `COALESCE(target, source)` — never overwrite.
3. Upsert each list as a `folders` row by `(user_id, 'granola', granolaListId)`. No hierarchy; all top-level. **Name collisions with existing user-created folders are NOT auto-merged** — they remain separate rows distinguished by `import_source`.
4. Upsert `media_objects` row by `(user_id, 'granola', granolaId)`, type=`'audio'`, all R2 keys NULL. Merge fields with `COALESCE`. Set `media_objects.attendees` jsonb to the array of resolved Loomola person UUIDs.
5. Upsert `notes` row (one per media_object) with `body = COALESCE(target.body, source.body)`.
6. Insert `transcripts` row if not present, `provider='granola'`. Content is normalized to the Deepgram-compatible paragraph shape (see Transcript normalization below).
7. Insert `speaker_assignments` rows from the speaker mapping (see Speaker indexing below). `is_suggestion=false`, `accepted_at=now()`. Skipped if any rows already exist for this `media_object_id` (merge idempotency at the child-row level).
8. Insert `media_folder_assignments` rows for each list mapping. Idempotent — skipped if `(media_object_id, folder_id)` already present.
9. Dual-write legacy `media_objects.folder_id`: if currently NULL, set it to the first list's folder_id (matches the multi-folder Phase 1 dual-write convention).
10. Upsert `ai_outputs` row: `title`, `summary`, `chapters=[]`, `action_items=[]`, `generation_status_value='complete'`, `provider='granola'`. Merge fields with `COALESCE`.

**After commit, outside the transaction:**
- If the `media_objects` row has no `folder_id` AND no rows in `media_folder_assignments`, queue `suggest_folder` pg-boss job with the standard `{ media_object_id, user_id, language: 'en' }` payload.

### Transcript normalization (Granola segments → Loomola transcript shape)

Granola transcripts identify speakers by Granola person UUID. Loomola's transcript renderer was built for Deepgram paragraphs. Rather than make the renderer provider-aware, the import endpoint normalizes Granola segments into the same paragraph shape Deepgram produces:

```json
{
  "paragraphs": [
    { "speaker": 0, "start": 0.0, "end": 5.3, "text": "..." },
    { "speaker": 1, "start": 5.3, "end": 9.1, "text": "..." }
  ]
}
```

Where `speaker` is the speaker_idx computed by the algorithm below. Unknown-speaker segments get `speaker: null` (already the convention for Deepgram diarization gaps).

### Speaker indexing algorithm

Per imported note:
1. Collect unique non-null `granolaPersonId`s from `transcript.segments`.
2. Sort by first-appearance time in the segment list.
3. Assign idx 0, 1, 2, … in that order.
4. For each speaker, look up the Loomola `person_id` upserted in step 2 of the write order (via `import_source_id=granolaPersonId`).
5. Insert `speaker_assignments(media_object_id, speaker_idx, person_id, is_suggestion=false, accepted_at=now())`.
6. Apply the same `granolaPersonId → speaker_idx` map when normalizing each segment for the transcript JSON.

### `is_self` resolution

The CLI sets `isSelf: true` on exactly the attendee whose `granolaPersonId` matches `self.id` from `/v2/get-me`. Server logic:
- If `people WHERE user_id=? AND is_self=true` already exists, the matching Granola attendee's row is merged into that existing row (granolaPersonId becomes the existing row's `import_source_id` — that field is currently null for natively-created people).
- If no `is_self` person exists yet, the matching Granola attendee is created with `is_self=true`.
- If no attendee carries `isSelf=true` (rare — meeting where you're somehow not in the attendee list), no `is_self` row is touched. The note still imports correctly.

### Settings → Migration page (`src/app/settings/migration/page.tsx`)

Server Component, gated by auth + `ENABLE_GRANOLA`. Three sections:

1. **Install** — `curl -L <release-url>/loomola-migrate -o loomola-migrate && chmod +x loomola-migrate`. Until release artifacts exist, instructions point at `cd migrate && bun run src/cli.ts granola`.
2. **Auth** — "Reveal access token" button → small client modal pulls the current session via `supabase.auth.getSession()` and shows `data.session.access_token` with a Copy button + a warning: *"This token is good for ~1 hour. If your import is interrupted, click Reveal again to get a fresh one — the CLI resumes from where it left off."*
3. **Run** — copy-pasteable command: `./loomola-migrate granola --server=https://loom.dissonance.cloud --token=<paste>`.

### Onboarding nudge

Dashboard shows a small dismissible banner when the authenticated user has zero `media_objects`: *"Coming from Granola? Migrate your backlog → Settings / Migration."* Dismissal stored in `localStorage` keyed by user id. Lives in `src/components/dashboard/empty-state-banner.tsx` next to the existing empty-state surface.

---

## CLI internals

### Bootstrap sequence

1. Read `~/Library/Application Support/Granola/supabase.json`. If file missing → fail with "Open Granola.app once and sign in, then re-run."
2. Copy `cache-v4.json` (or fall back to `cache-v3.json`) to `/tmp/loomola-migrate-cache-<runId>.json`. Read + parse from the copy. Avoids torn reads if Granola is open and writing.
3. `POST /v2/get-me` once via the WorkOS-authenticated client. Confirm `self.id` matches the cache. 401 → refresh once → retry → if still 401, fail with "Granola session expired. Open Granola.app, sign in, then re-run."
4. Read or create `~/.loomola-migrate/state.json`. Prompt user if a previous run exists (unless `--resume`/`--fresh`/`--retry-failed` is set).
5. Filter cache documents to those with `owner_id === self.id` and `--since` cutoff if provided. Drop documents in trash.

### ProseMirror → Markdown conversion

Granola stores note bodies as ProseMirror JSON. Loomola's `notes.body` is plain Markdown (same shape used by the desktop note workspace and the web note editor). The CLI does this conversion before sending — the server never sees ProseMirror.

Implementation: `prosemirror-markdown` library configured against Granola's known node types. Custom Granola block types (polls, decision blocks, anything template-specific) flatten to plain text or unordered-list bullets. This loss is documented in the README and accepted for v1.

### Granola API client

Three reverse-engineered endpoints used in v1:
- `POST /v1/get-document-transcript` — fetch transcript for one document (cache miss fallback).
- `POST /v2/get-people-batch` — enrich attendee email/name when cache lacks it.
- `POST /v2/get-me` — verify self identity.

Auth: WorkOS access token from `supabase.json` as bearer. 401 → call `auth.refresh()` (which hits the WorkOS refresh endpoint with the refresh_token) → retry once. Persistent 401 → abort with remediation instruction.

Rate limiter: token bucket, 5 req/s sustained, capacity 25 (matches Granola's documented limits per the official API docs, applied conservatively to the reverse-engineered endpoints too).

### Per-note pipeline

```
                    ┌── transcript miss → granola API fetch (rate-limited) ──┐
read cache → filter ┤                                                        ├→ shape payload → POST → write state
                    └── transcript hit  → use cached  ──────────────────────┘
```

Concurrency: 3 in-flight `POST /api/import/granola/note` requests at a time. Granola transcript fetches share the rate-limited bucket separately.

### Run state file (`~/.loomola-migrate/state.json`)

```jsonc
{
  "version": 1,
  "runId": "2026-05-06T15-23-04Z",
  "startedAt": "2026-05-06T15:23:04.123Z",
  "finishedAt": null,
  "loomolaServer": "https://loom.dissonance.cloud",
  "granolaCacheVersion": 4,
  "self": { "granolaId": "...", "loomolaUserId": "..." },
  "granolaIds": {
    "succeeded": ["uuid1", "uuid2"],
    "failed":    [{"id": "uuid3", "error": "...", "attempts": 3, "lastAttemptAt": "..."}],
    "skipped":   [{"id": "uuid4", "reason": "transcript-not-retrievable"}]
  }
}
```

Atomic update after each note's outcome (write-tmp + rename). Survives crashes mid-run.

### CLI flags

```
loomola-migrate granola [options]

Auth & target:
  --server <url>          (default: https://loom.dissonance.cloud)
  --token <jwt>           (or env LOOMOLA_TOKEN; prompts if neither set)

Scope:
  --since <iso-date>      Only import notes created on/after this date

Concurrency & throttle:
  --concurrency <n>       In-flight Loomola POSTs (default: 3, max: 10)

Run modes:
  --dry-run               Preview plan, write nothing
  --resume                Skip already-succeeded ids
  --fresh                 Ignore state.json, start over
  --retry-failed          Only retry previously-failed ids

Output:
  --json                  Machine-readable NDJSON to stdout
  --debug                 Verbose logging

Misc:
  --help, --version
```

### Failure taxonomy

| Class | Triggers | Behavior |
|---|---|---|
| **Transient** | network timeout, 5xx, 429 | Exponential backoff (250ms → 1s → 4s), 3 attempts. Then → permanent. |
| **Permanent (data)** | Granola 404 for transcript, missing required fields | Skip, log reason in `state.json`. Note still imports without that piece. |
| **Permanent (auth)** | 401/403 after refresh | Abort the run with specific remediation. |
| **Permanent (validation)** | 4xx from Loomola | Skip, log full server response, continue. Surfaces via final summary as "probably a CLI bug." |

A run that completes with all notes either succeeded or skipped exits 0. Any unrecovered failure → exit 1.

### Terminal output (default)

```
[ 47/187] ✓ "Q3 Planning Meeting"      created
[ 48/187] ↻ "Coffee with Sarah"        updated  (transcript filled in)
[ 49/187] ⊘ "Daily standup 4/12"       skipped  (transcript 404)
[ 50/187] ✗ "Client call — Acme"       failed   (timeout, retry exhausted)
        … 137 more …

Done in 6m 41s
  ✓ created  178   ↻ updated  4   ⊘ skipped  4   ✗ failed  1
  Logs: ~/.loomola-migrate/state.json
  Failed: 1 note. Re-run with --retry-failed to retry just those.
```

### Dry-run output

```
Plan
  Notes to import      : 187 (filtered from 203 total — 16 not owned by you)
  Cached transcripts   : 142
  Need fetch from Granola: 45
  Unique attendees     : 47
  Lists → folders      : 12
  Notes already imported: 0
  Estimated runtime    : ~7 min
```

### Edge cases handled at boot or in-line

- Granola desktop app never installed → `~/Library/Application Support/Granola/` missing → fail at boot with remediation.
- Granola signed out → `/v2/get-me` 401 after refresh → fail at boot with remediation.
- `cache-v4.json` corrupted → JSON parse error → fail at boot with remediation.
- Empty notes (no body, no summary, no transcript) → skip with reason `empty-note`. Common for calendar events that never happened.
- Cache contains notes you don't own → silently filter out.

---

## Idempotency rule (formal)

The migration is **merge / fill-the-gaps**: re-runs are strictly additive at the row level and strictly fill-only at the column level.

For each scalar column on each upserted row:
```sql
SET col = COALESCE(target.col, source.col)
```
Target value is preserved if non-null; source is used only if target is null/empty.

For each child row type (transcripts, speaker_assignments, media_folder_assignments):
- Insert only if no matching row exists for the parent.
- Never delete or overwrite existing child rows.

For folders & people: dedup on `(user_id, import_source, import_source_id)`. Name changes from Granola side do NOT update the row's name on re-run (would overwrite a user-edited folder name).

This rule guarantees:
- Running twice produces the same database state as running once (assuming Granola hasn't added new data).
- A user who edits an imported note inside Loomola is never overwritten by a re-run.
- Transient failures + retry do not corrupt data.
- A user who opens un-cached Granola notes between runs (causing transcripts to populate locally) gets transcripts filled in on the next run without other side effects.

---

## Testing strategy

| Layer | Where | What |
|---|---|---|
| **CLI unit (Vitest)** | `migrate/tests/` | Cache reader against fixture `cache-v4.json` (synthetic + redacted-real); Granola API client with mocked fetch (401→refresh→retry, rate-limiter); state-file atomic write; ProseMirror→Markdown converter. |
| **Server unit (Vitest)** | `tests/unit/import/granola/` | Pure transform functions: segment normalization, speaker-idx assignment, list dedup, the COALESCE upsert builder. |
| **Server integration (Vitest + real Postgres)** | `tests/integration/import-granola.test.ts` | `POST /api/import/granola/note` against a real Postgres in CI. Cases: fresh insert; re-POST identical payload (no duplicates, no overwrites); re-POST with transcript added (transcript appears, other fields untouched); orphan note → `suggest_folder` queued; note with 2 lists → no `suggest_folder`; speaker_assignments contain expected `(speaker_idx, person_id)` pairs; `is_self` resolution merges into existing self person rather than creating a duplicate. |
| **Real-world (manual)** | author's machine | Run CLI against actual ~200-note Granola backlog. Spot-check 10 random imports against their Granola originals. Run twice — second run is a no-op except for any new notes Granola added since the first run. |

---

## Acceptance criteria

- All three test layers green in CI.
- CLI run on author's actual backlog imports ≥95% of notes successfully (transcript-not-retrievable skips for older notes are expected and acceptable; outright failures should be near-zero).
- Settings → Migration page live behind `ENABLE_GRANOLA`.
- `migrate/README.md` documents install + run.
- Onboarding banner on the dashboard nudges users with zero recordings to Settings → Migration.

---

## Effort estimate

5–7 days, fits one 6-day cycle.

| Block | Days |
|---|---|
| Schema migration + import endpoint + Settings page + server tests | ~2 |
| CLI (cache reader, API client, transform, state, unit tests) | ~2 |
| Dogfood on real backlog + bug fixing | ~1–2 |
| README + buyer-facing doc polish | ~0.5 |

---

## Risks & assumptions

**Reverse-engineered Granola endpoints could rotate at any time.** `/v1/get-document-transcript`, `/v2/get-people-batch`, `/v2/get-me` are not officially supported for free/Pro tier users. They have worked for the community for over a year, but Granola is under no obligation to keep them stable. If they break before initial dogfood, the tool gracefully degrades to **cache-only** mode: notes whose transcripts aren't in `cache-v4.json` import without transcripts. Users can manually open un-cached notes in Granola to repopulate the cache, then re-run. This is a degraded experience but not a tool-killing one — the note body, title, summary, attendees, and meeting metadata still import.

**ProseMirror→Markdown conversion may flatten Granola-specific block types.** Polls, decision blocks, and other custom Granola template blocks fall back to plain text. Documented in the README. Revisit if buyers report meaningful loss.

**1-hour Supabase access-token TTL.** A long import (e.g., 500+ notes with all transcripts uncached) could exceed the token's lifetime. The CLI will fail with a clear "token expired, refresh and resume" message; merge idempotency means resume is safe. If buyer complaints make this annoying, follow up with a longer-lived migration-specific JWT minted from a new endpoint.

**Granola free-tier ToS.** Encouraging free-tier users to use reverse-engineered endpoints sits in a gray area. The community ecosystem has lived in this space without incident, but the buyer-facing README should include a one-liner: *"This tool reads your own Granola data via your local Granola desktop session. It does not bypass any payment gate. Use at your own risk."*

**Single-user assumption.** v1 assumes one Granola account → one Loomola account. Users with both work and personal Granola accounts will need to run the CLI twice with different `LOOMOLA_TOKEN` values. Not in scope to handle merging two Granola accounts into one Loomola.

**Granola Lists multiplicity.** v1 assumes a Granola note can be in multiple Lists; the multi-folder mapping handles this correctly. If Granola turns out to be single-list-per-note, the multi-folder assignment code is correct but unused — no rework needed.

---

## Open follow-ups (post-v1, separate specs)

- **Loom migration** — the next bundled feature. Will land alongside this once Granola has been dogfooded.
- **Granola action items extraction** — once we see what shape they take in real cache data.
- **Buyer-facing distribution channel** — a real release page with versioned binaries, signed + notarized for a "double-click to install" experience.
- **Migration-specific JWT minting endpoint** — if the 1-hour TTL becomes an annoyance.
- **Bulk diff/preview** — show the user what would change on existing notes before committing. Cheap to add given merge idempotency.
- **`media_folder_assignments` Phase 2 alignment** — once the legacy `media_objects.folder_id` column is dropped, drop the dual-write step (9) from this endpoint.
