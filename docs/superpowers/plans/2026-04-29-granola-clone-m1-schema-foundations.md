# Granola-alt — Milestone 1: Schema Foundations + Notes API — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the full Granola-alt MVP data model — six new tables, four extended tables, pgvector + Supabase Realtime, RLS policies — and prove the data layer works end-to-end via thin API endpoints for each new entity. No UI, no recording, no AI yet — just the foundation everything else stands on.

**Architecture:** Drizzle schema in `src/db/schema.ts` extends the existing six tables and adds six new ones. `drizzle-kit generate` produces auto-migrations for the type/column changes; hand-written supplementary migrations cover pgvector extension, RLS policies, and the Realtime publication. All new tables join through `mediaObjectId → media_objects(ownerId)` for RLS where applicable. Query modules under `src/db/queries/` are added for `notes`, `people`, `dictionary-terms`, `speaker-assignments`. JSON API endpoints under `src/app/api/` wire each entity to the world. A Vitest integration test plus a Playwright smoke test prove the round-trip works end-to-end.

**Tech Stack:** Drizzle ORM 0.45 + `postgres` 3.4 driver, drizzle-kit 0.31, Supabase Postgres with pgvector, Next.js 15 App Router, TypeScript 5, Vitest 4, Playwright 1.59, Doppler CLI.

---

## Roadmap (Reference)

Granola-alt MVP is built across 11 milestones, each planned separately. After M1 ships and is verified live, re-invoke `superpowers:writing-plans` targeting M2.

- **M1: Schema Foundations + Notes API** (this plan) — six new tables, four extended tables, pgvector, Realtime publication, RLS, thin CRUD API for each new entity.
- **M2: Audio Ingest Pipeline** — backend changes to the existing `transcribe` job to accept audio-only `media_objects`, ffmpeg mic+system mixing into `r2MixedKey`, new `audio_waveform` pg-boss job.
- **M3: Desktop App — Manual Recording Trigger** — Swift `desktop/` extension: menubar item to manually start a recording (no meeting detection yet), ScreenCaptureKit + AVFoundation capture, multipart upload to R2 as `type='audio'`. Lets us test the audio pipeline without depending on M9.
- **M4: `/notes/:id` Granola UI** — single-column markdown canvas (Tiptap), metadata pill row (Date · Attendees · Folder), persistent bottom strip with clickable volume waveform, floating transcript card. Recording-stopped state only initially (live state lands later).
- **M5: Tabbed Dashboard** — `/` becomes Recordings | Notes tabs. Notes tab is chronological list grouped by date. Shared sidebar with folders and search. Existing Recordings tab UI unchanged.
- **M6: Speaker Labeling MVP** — `/people` settings page, pre-meeting attendee picker on desktop app, speaker chip popover in transcript card, `speaker_assignments` round-trip.
- **M7: Shared Dictionary** — `/dictionary` settings page, Deepgram `keyterms` wiring on every transcribe call, variant-collapsing post-processor.
- **M8: pgvector Embedding-on-Write** — `embed_transcript` and `embed_summary` pg-boss jobs running OpenAI `text-embedding-3-small` on transcript chunks and summaries. No retrieval UI; passive corpus accumulation.
- **M9: AI Enhancement (User-Triggered, Streaming)** — "Generate notes" button fires `title_summary` + `chapters` + `action_items` jobs. Vercel AI SDK `streamText` writes incremental tokens to `ai_outputs.summary`. Supabase Realtime pushes to `/notes/:id`. "Enhancing notes" pill spinner UX.
- **M10: Per-Project Obsidian Sync** — `brand_profiles.meetingNotesVaultPath` field, manual "Save to Obsidian" button on `/notes/:id`, desktop app subscriber + filesystem writer, three-level path resolution.
- **M11: LLM-Accessible API + Desktop Meeting Detection** — `INTEGRATION_API_TOKEN` bearer auth, `GET /api/notes/:id/export.json`, `GET /api/export/bundle.zip`, NSWorkspace meeting-app detection in desktop, Chrome extension content scripts for Meet/Teams web, native messaging host, auto-arm UX.

---

## File Structure (Milestone 1)

```
Loom_Clone/
├── drizzle/
│   ├── 0010_pgvector_extension.sql        # NEW — hand-written
│   ├── 0011_granola_schema.sql            # NEW — drizzle-generated
│   ├── 0012_granola_rls.sql               # NEW — hand-written
│   ├── 0013_realtime_ai_outputs.sql       # NEW — hand-written
│   └── meta/_journal.json                  # MODIFIED — adds 0010-0013
├── src/
│   ├── db/
│   │   ├── schema.ts                       # MODIFIED — 6 new tables, 4 extended
│   │   └── queries/
│   │       ├── notes.ts                    # NEW
│   │       ├── people.ts                   # NEW
│   │       ├── dictionary-terms.ts         # NEW
│   │       └── speaker-assignments.ts      # NEW
│   └── app/api/
│       ├── notes/[id]/route.ts             # NEW — GET / PUT for notes.body
│       ├── people/route.ts                 # NEW — list / create
│       ├── people/[id]/route.ts            # NEW — get / update / delete
│       ├── dictionary-terms/route.ts       # NEW — list / create
│       ├── dictionary-terms/[id]/route.ts  # NEW — update / delete
│       └── speaker-assignments/[mediaId]/route.ts  # NEW — list / upsert by speakerIdx
├── tests/
│   ├── unit/
│   │   ├── notes-queries.test.ts           # NEW
│   │   ├── people-queries.test.ts          # NEW
│   │   ├── dictionary-queries.test.ts      # NEW
│   │   └── speaker-assignments.test.ts     # NEW
│   └── e2e/
│       └── granola-m1-smoke.spec.ts        # NEW — round-trip test
└── docs/superpowers/plans/
    └── 2026-04-29-granola-clone-m1-schema-foundations.md  # this file
```

**File responsibility boundaries:**
- `src/db/schema.ts` is the single source of truth for the Drizzle schema. Type-correct here ⇒ migrations work.
- `src/db/queries/<entity>.ts` — one file per entity, each exporting tightly-typed functions. They use the `postgres` role driver which **bypasses RLS**. Ownership is enforced in the query implementations themselves.
- `src/app/api/<entity>/route.ts` — thin handlers that authenticate via `@supabase/ssr`, then call the query module. Response shape is JSON.
- `tests/unit/*.test.ts` use a clean test schema (`pgTAP`-style isolation via transaction rollback). Each test creates its own owner UUID and asserts ownership boundaries.
- `tests/e2e/granola-m1-smoke.spec.ts` runs against a running dev server (`npm run dev` + Doppler), creates a real `media_objects` row of `type='audio'`, attaches a notes row, reads it back, asserts shape.

**Conventions to maintain:**
- Drizzle TS field names are camelCase (`mediaObjectId`); SQL columns are snake_case (`media_object_id`). The mapping is explicit in `pgTable("...", { mediaObjectId: uuid("media_object_id") })`.
- All `ownerId` columns are `uuid NOT NULL` matching the existing `media_objects.ownerId` pattern.
- All timestamps are `timestamptz` with `DEFAULT now()`.
- All FKs to `media_objects(id)` use `ON DELETE CASCADE`.
- New tables get RLS enabled via the same `DO $$ BEGIN ... END $$` idempotent pattern in `0006_folders_rls.sql`.
- The `--> statement-breakpoint` separator is preserved in hand-written migrations (Drizzle's migration runner relies on it).

---

## Tasks

### Task 1: Add pgvector extension migration

**Files:**
- Create: `drizzle/0010_pgvector_extension.sql`
- Modify: `drizzle/meta/_journal.json` (append entry)

- [ ] **Step 1: Write the migration SQL**

Create `drizzle/0010_pgvector_extension.sql`:

```sql
--> Enables the pgvector extension. Used by transcript_chunks.embedding and
--> summary_embeddings.embedding to store OpenAI text-embedding-3-small vectors
--> (1536 dims) and run cosine-similarity queries via HNSW indices.
-->
--> Idempotent — safe to re-run.

--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS vector;
```

- [ ] **Step 2: Append the migration to the journal**

Read the current `drizzle/meta/_journal.json` and append a new entry at the end of `entries` (preserving the existing structure). The new entry should match the format of existing entries (incremented `idx`, current timestamp, `tag` matching the filename without `.sql`).

```jsonc
// example shape — match the existing pattern in the file
{
  "idx": 10,
  "version": "7",
  "when": <current_unix_ms>,
  "tag": "0010_pgvector_extension",
  "breakpoints": true
}
```

- [ ] **Step 3: Run the migration locally to verify**

```bash
doppler run --project dissonance-cloud --config prd_loom -- npm run db:migrate
```

Expected output: `migrations applied`

Then verify the extension is installed:

```bash
doppler run --project dissonance-cloud --config prd_loom -- node -e "
  const postgres = require('postgres');
  const sql = postgres(process.env.DATABASE_URL);
  sql\`SELECT * FROM pg_extension WHERE extname = 'vector'\`.then(r => {
    console.log('vector extension:', r.length > 0 ? 'INSTALLED' : 'MISSING');
    return sql.end();
  });
"
```

Expected: `vector extension: INSTALLED`

- [ ] **Step 4: Commit**

```bash
git add drizzle/0010_pgvector_extension.sql drizzle/meta/_journal.json
git commit -m "feat(db): add pgvector extension for transcript + summary embeddings"
```

---

### Task 2: Add new tables and field extensions to Drizzle schema

**Files:**
- Modify: `src/db/schema.ts`

- [ ] **Step 1: Read the existing schema**

```bash
cat src/db/schema.ts
```

Note the existing imports, the `customType` definition for `tsvector`, and the existing table definitions. The new code must follow the same conventions.

- [ ] **Step 2: Add the `vector` customType helper**

Just below the existing `tsvector` customType in `src/db/schema.ts`, add:

```ts
const vector1536 = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return "vector(1536)";
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: string): number[] {
    return JSON.parse(value);
  },
});
```

- [ ] **Step 3: Extend the `mediaObjects` table with Granola fields**

Inside the existing `mediaObjects` `pgTable` definition, append the following fields just before the `createdAt` field (so they appear in the SQL DDL right before the timestamps):

```ts
  // --- Granola-alt fields (M1) ---
  meetingDetectedApp: text("meeting_detected_app"),  // 'zoom' | 'meet' | 'teams' | null
  meetingStartedAtLocal: timestamp("meeting_started_at_local", { withTimezone: true }),
  attendees: jsonb("attendees"),  // jsonb array of person UUIDs
  r2MixedKey: text("r2_mixed_key"),  // mic+system audio mixed mono file
  obsidianSaveRequestedAt: timestamp("obsidian_save_requested_at", { withTimezone: true }),
  obsidianSyncedAt: timestamp("obsidian_synced_at", { withTimezone: true }),
  sourceContextHint: text("source_context_hint"),  // e.g. browser tab title for ad-hoc captures
```

- [ ] **Step 4: Extend `transcripts` with provider abstraction fields**

Inside the existing `transcripts` `pgTable` definition, before `createdAt`, add:

```ts
  // --- Granola-alt fields (M1) ---
  provider: text("provider").notNull().default("deepgram"),
  providerRequestId: text("provider_request_id"),  // Replaces deepgramRequestId in app code; old col stays for now
```

(`deepgramRequestId` stays in place; it'll be dropped in a follow-up migration after code is updated to use `providerRequestId`.)

- [ ] **Step 5: Extend `aiOutputs` with template + streaming fields**

Add a new enum for the generation status:

```ts
export const generationStatus = pgEnum("generation_status", [
  "pending",
  "streaming",
  "complete",
  "failed",
]);
```

Inside the existing `aiOutputs` `pgTable` definition, before `generatedAt`, add:

```ts
  // --- Granola-alt fields (M1) ---
  templateId: text("template_id").notNull().default("default"),
  generationStatusValue: generationStatus("generation_status").notNull().default("complete"),
```

(Note: the field is `generationStatusValue` in TS to avoid colliding with the enum name. SQL column is `generation_status`.)

- [ ] **Step 6: Extend `brandProfiles` with vault path field**

Inside the existing `brandProfiles` `pgTable` definition, before `createdAt`, add:

```ts
  // --- Granola-alt fields (M1) ---
  meetingNotesVaultPath: text("meeting_notes_vault_path"),
```

- [ ] **Step 7: Add the `notes` table**

Below the existing tables in `src/db/schema.ts`, add:

```ts
// ---------------------------------------------------------------------------
// notes — user's hand-typed markdown notes per audio meeting
// ---------------------------------------------------------------------------

export const notes = pgTable(
  "notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mediaObjectId: uuid("media_object_id")
      .notNull()
      .references(() => mediaObjects.id, { onDelete: "cascade" }),
    ownerId: uuid("owner_id").notNull(),
    body: text("body").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    mediaObjectIdx: uniqueIndex("notes_media_object_idx").on(t.mediaObjectId),
    ownerIdx: index("notes_owner_idx").on(t.ownerId),
  })
);
```

- [ ] **Step 8: Add the `people` table**

```ts
// ---------------------------------------------------------------------------
// people — known meeting participants (user's contacts)
// ---------------------------------------------------------------------------

export const people = pgTable(
  "people",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id").notNull(),
    displayName: text("display_name").notNull(),
    email: text("email"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    ownerIdx: index("people_owner_idx").on(t.ownerId),
  })
);
```

- [ ] **Step 9: Add the `speakerAssignments` table**

```ts
// ---------------------------------------------------------------------------
// speaker_assignments — per-recording speaker_idx → person mapping
// ---------------------------------------------------------------------------

export const speakerAssignments = pgTable(
  "speaker_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mediaObjectId: uuid("media_object_id")
      .notNull()
      .references(() => mediaObjects.id, { onDelete: "cascade" }),
    speakerIdx: integer("speaker_idx").notNull(),
    personId: uuid("person_id").references(() => people.id, { onDelete: "set null" }),
    displayLabelOverride: text("display_label_override"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    mediaSpeakerIdx: uniqueIndex("speaker_assignments_media_speaker_idx").on(
      t.mediaObjectId,
      t.speakerIdx
    ),
  })
);
```

(You'll also need to add `integer` to the imports at the top of the file: `import { ... integer } from "drizzle-orm/pg-core";`)

- [ ] **Step 10: Add the `dictionaryTerms` table**

```ts
// ---------------------------------------------------------------------------
// dictionary_terms — shared vocabulary for transcription (audio + video)
// ---------------------------------------------------------------------------

export const dictionaryTerms = pgTable(
  "dictionary_terms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id").notNull(),
    term: text("term").notNull(),
    variantOf: uuid("variant_of"),  // self-referential FK; resolved at app layer
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    ownerIdx: index("dictionary_terms_owner_idx").on(t.ownerId),
    ownerTermIdx: uniqueIndex("dictionary_terms_owner_term_idx").on(t.ownerId, t.term),
  })
);
```

- [ ] **Step 11: Add the `transcriptChunks` table**

```ts
// ---------------------------------------------------------------------------
// transcript_chunks — chunked transcript with embeddings (pgvector)
// ---------------------------------------------------------------------------

export const transcriptChunks = pgTable(
  "transcript_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mediaObjectId: uuid("media_object_id")
      .notNull()
      .references(() => mediaObjects.id, { onDelete: "cascade" }),
    chunkIdx: integer("chunk_idx").notNull(),
    text: text("text").notNull(),
    startMs: integer("start_ms").notNull(),
    endMs: integer("end_ms").notNull(),
    embedding: vector1536("embedding").notNull(),
    modelVersion: text("model_version").notNull().default("openai/text-embedding-3-small"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    mediaIdx: index("transcript_chunks_media_idx").on(t.mediaObjectId),
  })
);
```

(The HNSW index on `embedding` is added in the hand-written migration in Task 4 — Drizzle doesn't generate `USING hnsw` natively.)

- [ ] **Step 12: Add the `summaryEmbeddings` table**

```ts
// ---------------------------------------------------------------------------
// summary_embeddings — one embedding per meeting's polished summary
// ---------------------------------------------------------------------------

export const summaryEmbeddings = pgTable(
  "summary_embeddings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mediaObjectId: uuid("media_object_id")
      .notNull()
      .references(() => mediaObjects.id, { onDelete: "cascade" })
      .unique(),
    embedding: vector1536("embedding").notNull(),
    modelVersion: text("model_version").notNull().default("openai/text-embedding-3-small"),
    generatedAt: timestamp("generated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  }
);
```

- [ ] **Step 13: Verify the schema file compiles**

```bash
npm run typecheck
```

Expected: no errors related to `src/db/schema.ts`. (Pre-existing unrelated errors elsewhere in the repo are fine; just look for `src/db/schema.ts` lines.)

- [ ] **Step 14: Commit**

```bash
git add src/db/schema.ts
git commit -m "feat(db): extend schema with granola-alt tables and field additions"
```

---

### Task 3: Generate the Drizzle migration

**Files:**
- Create: `drizzle/0011_granola_schema.sql` (auto-generated)
- Modify: `drizzle/meta/_journal.json` (auto-extended by drizzle-kit)
- Modify: `drizzle/meta/0011_snapshot.json` (auto-generated)

- [ ] **Step 1: Run drizzle-kit generate**

```bash
npm run db:generate
```

Expected: drizzle-kit prompts a migration name. Type `granola_schema` and hit Enter. It writes:
- `drizzle/0011_granola_schema.sql` (DDL for new tables and column additions)
- `drizzle/meta/0011_snapshot.json`
- Appends an entry to `drizzle/meta/_journal.json`

- [ ] **Step 2: Inspect the generated SQL**

```bash
cat drizzle/0011_granola_schema.sql
```

Expected: contains `CREATE TABLE notes`, `CREATE TABLE people`, `CREATE TABLE speaker_assignments`, `CREATE TABLE dictionary_terms`, `CREATE TABLE transcript_chunks`, `CREATE TABLE summary_embeddings`, plus `ALTER TABLE media_objects ADD COLUMN ...` for the seven new fields, etc. Also: `CREATE TYPE generation_status`, `ALTER TABLE ai_outputs ADD COLUMN generation_status`.

If the file is missing the `vector(1536)` type for embedding columns (drizzle-kit may render it as `text` by default), edit it manually so those columns read `"embedding" vector(1536) NOT NULL` and the snapshot file matches.

- [ ] **Step 3: Apply the migration to the dev database**

```bash
doppler run --project dissonance-cloud --config prd_loom -- npm run db:migrate
```

Expected: `migrations applied`

- [ ] **Step 4: Verify the new tables and columns exist**

```bash
doppler run --project dissonance-cloud --config prd_loom -- node -e "
  const postgres = require('postgres');
  const sql = postgres(process.env.DATABASE_URL);
  Promise.all([
    sql\`SELECT to_regclass('public.notes') as t\`,
    sql\`SELECT to_regclass('public.people') as t\`,
    sql\`SELECT to_regclass('public.speaker_assignments') as t\`,
    sql\`SELECT to_regclass('public.dictionary_terms') as t\`,
    sql\`SELECT to_regclass('public.transcript_chunks') as t\`,
    sql\`SELECT to_regclass('public.summary_embeddings') as t\`,
    sql\`SELECT column_name FROM information_schema.columns WHERE table_name = 'media_objects' AND column_name IN ('meeting_detected_app','attendees','r2_mixed_key','obsidian_synced_at')\`,
    sql\`SELECT column_name FROM information_schema.columns WHERE table_name = 'brand_profiles' AND column_name = 'meeting_notes_vault_path'\`,
  ]).then(([n, p, sa, dt, tc, se, mo, bp]) => {
    console.log('notes:', n[0].t);
    console.log('people:', p[0].t);
    console.log('speaker_assignments:', sa[0].t);
    console.log('dictionary_terms:', dt[0].t);
    console.log('transcript_chunks:', tc[0].t);
    console.log('summary_embeddings:', se[0].t);
    console.log('media_objects new cols:', mo.length, 'expected: 4');
    console.log('brand_profiles meeting_notes_vault_path:', bp.length === 1 ? 'OK' : 'MISSING');
    return sql.end();
  });
"
```

Expected: every line should report a non-null table or `OK`. The new media_objects column count should be `4`.

- [ ] **Step 5: Commit**

```bash
git add drizzle/0011_granola_schema.sql drizzle/meta/0011_snapshot.json drizzle/meta/_journal.json
git commit -m "feat(db): generate migration for granola-alt tables"
```

---

### Task 4: Hand-written RLS + HNSW index migration

**Files:**
- Create: `drizzle/0012_granola_rls.sql`
- Modify: `drizzle/meta/_journal.json` (append entry idx 12)

- [ ] **Step 1: Write the RLS + HNSW migration**

Create `drizzle/0012_granola_rls.sql`:

```sql
--> Enables RLS on all six new Granola-alt tables and creates a single
--> "owner_all" policy on each (matching the pattern in 0001 + 0006).
-->
--> Tables that have ownerId directly: notes, people, dictionary_terms.
--> Tables that join through media_objects: speaker_assignments,
--> transcript_chunks, summary_embeddings.
-->
--> Also creates the HNSW indices on the two embedding columns —
--> drizzle-kit doesn't generate `USING hnsw` natively.
-->
--> All statements idempotent.

--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'public' AND c.relname = 'notes' AND c.relrowsecurity = true) THEN
    EXECUTE 'ALTER TABLE "notes" ENABLE ROW LEVEL SECURITY';
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notes' AND policyname = 'notes_owner_all') THEN
    EXECUTE $POLICY$
      CREATE POLICY "notes_owner_all" ON "notes"
        AS PERMISSIVE FOR ALL TO authenticated
        USING (owner_id = auth.uid())
        WITH CHECK (owner_id = auth.uid())
    $POLICY$;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'public' AND c.relname = 'people' AND c.relrowsecurity = true) THEN
    EXECUTE 'ALTER TABLE "people" ENABLE ROW LEVEL SECURITY';
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'people' AND policyname = 'people_owner_all') THEN
    EXECUTE $POLICY$
      CREATE POLICY "people_owner_all" ON "people"
        AS PERMISSIVE FOR ALL TO authenticated
        USING (owner_id = auth.uid())
        WITH CHECK (owner_id = auth.uid())
    $POLICY$;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'public' AND c.relname = 'dictionary_terms' AND c.relrowsecurity = true) THEN
    EXECUTE 'ALTER TABLE "dictionary_terms" ENABLE ROW LEVEL SECURITY';
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'dictionary_terms' AND policyname = 'dictionary_terms_owner_all') THEN
    EXECUTE $POLICY$
      CREATE POLICY "dictionary_terms_owner_all" ON "dictionary_terms"
        AS PERMISSIVE FOR ALL TO authenticated
        USING (owner_id = auth.uid())
        WITH CHECK (owner_id = auth.uid())
    $POLICY$;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'public' AND c.relname = 'speaker_assignments' AND c.relrowsecurity = true) THEN
    EXECUTE 'ALTER TABLE "speaker_assignments" ENABLE ROW LEVEL SECURITY';
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'speaker_assignments' AND policyname = 'speaker_assignments_owner_via_media') THEN
    EXECUTE $POLICY$
      CREATE POLICY "speaker_assignments_owner_via_media" ON "speaker_assignments"
        AS PERMISSIVE FOR ALL TO authenticated
        USING (EXISTS (SELECT 1 FROM media_objects m WHERE m.id = media_object_id AND m.owner_id = auth.uid()))
        WITH CHECK (EXISTS (SELECT 1 FROM media_objects m WHERE m.id = media_object_id AND m.owner_id = auth.uid()))
    $POLICY$;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'public' AND c.relname = 'transcript_chunks' AND c.relrowsecurity = true) THEN
    EXECUTE 'ALTER TABLE "transcript_chunks" ENABLE ROW LEVEL SECURITY';
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'transcript_chunks' AND policyname = 'transcript_chunks_owner_via_media') THEN
    EXECUTE $POLICY$
      CREATE POLICY "transcript_chunks_owner_via_media" ON "transcript_chunks"
        AS PERMISSIVE FOR ALL TO authenticated
        USING (EXISTS (SELECT 1 FROM media_objects m WHERE m.id = media_object_id AND m.owner_id = auth.uid()))
        WITH CHECK (EXISTS (SELECT 1 FROM media_objects m WHERE m.id = media_object_id AND m.owner_id = auth.uid()))
    $POLICY$;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'public' AND c.relname = 'summary_embeddings' AND c.relrowsecurity = true) THEN
    EXECUTE 'ALTER TABLE "summary_embeddings" ENABLE ROW LEVEL SECURITY';
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'summary_embeddings' AND policyname = 'summary_embeddings_owner_via_media') THEN
    EXECUTE $POLICY$
      CREATE POLICY "summary_embeddings_owner_via_media" ON "summary_embeddings"
        AS PERMISSIVE FOR ALL TO authenticated
        USING (EXISTS (SELECT 1 FROM media_objects m WHERE m.id = media_object_id AND m.owner_id = auth.uid()))
        WITH CHECK (EXISTS (SELECT 1 FROM media_objects m WHERE m.id = media_object_id AND m.owner_id = auth.uid()))
    $POLICY$;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS transcript_chunks_embedding_idx
  ON transcript_chunks USING hnsw (embedding vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS summary_embeddings_embedding_idx
  ON summary_embeddings USING hnsw (embedding vector_cosine_ops);
```

- [ ] **Step 2: Append journal entry**

Append a new entry to `drizzle/meta/_journal.json` with `idx: 12`, current timestamp, `tag: "0012_granola_rls"`, `breakpoints: true`.

- [ ] **Step 3: Run the migration**

```bash
doppler run --project dissonance-cloud --config prd_loom -- npm run db:migrate
```

Expected: `migrations applied`

- [ ] **Step 4: Verify RLS + indices**

```bash
doppler run --project dissonance-cloud --config prd_loom -- node -e "
  const postgres = require('postgres');
  const sql = postgres(process.env.DATABASE_URL);
  Promise.all([
    sql\`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('notes','people','dictionary_terms','speaker_assignments','transcript_chunks','summary_embeddings') AND rowsecurity\`,
    sql\`SELECT indexname FROM pg_indexes WHERE indexname IN ('transcript_chunks_embedding_idx','summary_embeddings_embedding_idx')\`,
  ]).then(([rls, idx]) => {
    console.log('RLS-enabled tables:', rls.length, 'expected: 6');
    console.log('HNSW indices:', idx.length, 'expected: 2');
    return sql.end();
  });
"
```

Expected: `RLS-enabled tables: 6 expected: 6` and `HNSW indices: 2 expected: 2`.

- [ ] **Step 5: Commit**

```bash
git add drizzle/0012_granola_rls.sql drizzle/meta/_journal.json
git commit -m "feat(db): RLS policies and HNSW indices for granola-alt tables"
```

---

### Task 5: Realtime publication on `ai_outputs`

**Files:**
- Create: `drizzle/0013_realtime_ai_outputs.sql`
- Modify: `drizzle/meta/_journal.json`

- [ ] **Step 1: Write the migration**

Create `drizzle/0013_realtime_ai_outputs.sql`:

```sql
--> Adds the ai_outputs table to the supabase_realtime publication so the
--> M9 streaming AI enhancement UX can push token-level updates to the
--> /notes/:id page via Supabase Realtime websocket.
-->
--> Idempotent: if ai_outputs is already in the publication this is a
--> no-op error which we swallow.

--> statement-breakpoint
DO $$ BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE ai_outputs;
  EXCEPTION
    WHEN duplicate_object THEN
      -- already in the publication; nothing to do
      NULL;
  END;
END $$;
```

- [ ] **Step 2: Append journal entry idx 13**

- [ ] **Step 3: Run the migration**

```bash
doppler run --project dissonance-cloud --config prd_loom -- npm run db:migrate
```

- [ ] **Step 4: Verify ai_outputs is in the publication**

```bash
doppler run --project dissonance-cloud --config prd_loom -- node -e "
  const postgres = require('postgres');
  const sql = postgres(process.env.DATABASE_URL);
  sql\`SELECT * FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='ai_outputs'\`.then(r => {
    console.log('ai_outputs in supabase_realtime:', r.length === 1 ? 'YES' : 'NO');
    return sql.end();
  });
"
```

Expected: `ai_outputs in supabase_realtime: YES`

- [ ] **Step 5: Commit**

```bash
git add drizzle/0013_realtime_ai_outputs.sql drizzle/meta/_journal.json
git commit -m "feat(db): add ai_outputs to supabase_realtime publication"
```

---

### Task 6: `notes` query module + tests

**Files:**
- Create: `src/db/queries/notes.ts`
- Create: `tests/unit/notes-queries.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/notes-queries.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { db } from "@/db";
import { mediaObjects, notes } from "@/db/schema";
import { upsertNotesBody, getNotesByMediaObject, deleteNotes } from "@/db/queries/notes";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

const OWNER_A = randomUUID();
const OWNER_B = randomUUID();

async function createMediaObject(ownerId: string) {
  const slug = `test-${randomUUID().slice(0, 8)}`;
  const [m] = await db.insert(mediaObjects).values({
    ownerId,
    type: "audio",
    slug,
    status: "ready",
  }).returning();
  return m;
}

afterEach(async () => {
  // tear down test rows by owner
  await db.delete(mediaObjects).where(eq(mediaObjects.ownerId, OWNER_A));
  await db.delete(mediaObjects).where(eq(mediaObjects.ownerId, OWNER_B));
});

describe("notes queries", () => {
  it("upsertNotesBody creates a row when none exists", async () => {
    const m = await createMediaObject(OWNER_A);
    const result = await upsertNotesBody(m.id, OWNER_A, "Hello world");
    expect(result.body).toBe("Hello world");
    expect(result.mediaObjectId).toBe(m.id);
    expect(result.ownerId).toBe(OWNER_A);
  });

  it("upsertNotesBody updates the existing row when one exists", async () => {
    const m = await createMediaObject(OWNER_A);
    await upsertNotesBody(m.id, OWNER_A, "First");
    const result = await upsertNotesBody(m.id, OWNER_A, "Second");
    expect(result.body).toBe("Second");

    const all = await db.select().from(notes).where(eq(notes.mediaObjectId, m.id));
    expect(all.length).toBe(1);
  });

  it("getNotesByMediaObject returns null when no row exists", async () => {
    const m = await createMediaObject(OWNER_A);
    const result = await getNotesByMediaObject(m.id, OWNER_A);
    expect(result).toBeNull();
  });

  it("getNotesByMediaObject returns the row for the correct owner", async () => {
    const m = await createMediaObject(OWNER_A);
    await upsertNotesBody(m.id, OWNER_A, "Owner A's notes");
    const result = await getNotesByMediaObject(m.id, OWNER_A);
    expect(result?.body).toBe("Owner A's notes");
  });

  it("getNotesByMediaObject returns null for a different owner", async () => {
    const m = await createMediaObject(OWNER_A);
    await upsertNotesBody(m.id, OWNER_A, "Owner A's notes");
    const result = await getNotesByMediaObject(m.id, OWNER_B);
    expect(result).toBeNull();
  });

  it("deleteNotes removes the row", async () => {
    const m = await createMediaObject(OWNER_A);
    await upsertNotesBody(m.id, OWNER_A, "to delete");
    const removed = await deleteNotes(m.id, OWNER_A);
    expect(removed).toBe(true);
    const result = await getNotesByMediaObject(m.id, OWNER_A);
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
doppler run --project dissonance-cloud --config prd_loom -- npm run test -- notes-queries
```

Expected: FAIL with `Cannot find module '@/db/queries/notes'`.

- [ ] **Step 3: Implement the query module**

Create `src/db/queries/notes.ts`:

```ts
import { db } from "@/db";
import { notes, mediaObjects } from "@/db/schema";
import { and, eq } from "drizzle-orm";

/**
 * Upsert the user's hand-typed notes for a meeting.
 * Enforces ownership: rejects if media_object's ownerId doesn't match.
 */
export async function upsertNotesBody(
  mediaObjectId: string,
  ownerId: string,
  body: string
) {
  // Verify ownership of the media_object before any write.
  const [media] = await db
    .select({ id: mediaObjects.id, ownerId: mediaObjects.ownerId })
    .from(mediaObjects)
    .where(eq(mediaObjects.id, mediaObjectId))
    .limit(1);

  if (!media || media.ownerId !== ownerId) {
    throw new Error("media_object not found or not owned by user");
  }

  const [row] = await db
    .insert(notes)
    .values({
      mediaObjectId,
      ownerId,
      body,
    })
    .onConflictDoUpdate({
      target: notes.mediaObjectId,
      set: { body, updatedAt: new Date() },
    })
    .returning();

  return row;
}

/**
 * Fetch notes for a meeting. Returns null if not present or owner mismatch.
 */
export async function getNotesByMediaObject(
  mediaObjectId: string,
  ownerId: string
) {
  const [row] = await db
    .select()
    .from(notes)
    .where(
      and(eq(notes.mediaObjectId, mediaObjectId), eq(notes.ownerId, ownerId))
    )
    .limit(1);

  return row ?? null;
}

/**
 * Delete notes for a meeting. Returns true when a row was deleted.
 */
export async function deleteNotes(mediaObjectId: string, ownerId: string) {
  const result = await db
    .delete(notes)
    .where(
      and(eq(notes.mediaObjectId, mediaObjectId), eq(notes.ownerId, ownerId))
    )
    .returning({ id: notes.id });

  return result.length > 0;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
doppler run --project dissonance-cloud --config prd_loom -- npm run test -- notes-queries
```

Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/queries/notes.ts tests/unit/notes-queries.test.ts
git commit -m "feat(api): add notes query module with upsert/get/delete"
```

---

### Task 7: `notes` API endpoint

**Files:**
- Create: `src/app/api/notes/[id]/route.ts`

- [ ] **Step 1: Write the route handler**

Create `src/app/api/notes/[id]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/require-auth";
import {
  upsertNotesBody,
  getNotesByMediaObject,
  deleteNotes,
} from "@/db/queries/notes";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth(request);
  const { id } = await params;

  const row = await getNotesByMediaObject(id, user.id);
  if (!row) return NextResponse.json({ body: "" }, { status: 200 });
  return NextResponse.json(row, { status: 200 });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth(request);
  const { id } = await params;

  const json = await request.json().catch(() => null);
  if (!json || typeof json.body !== "string") {
    return NextResponse.json({ error: "body_required" }, { status: 400 });
  }

  try {
    const row = await upsertNotesBody(id, user.id, json.body);
    return NextResponse.json(row, { status: 200 });
  } catch {
    return NextResponse.json({ error: "media_object_not_found" }, { status: 404 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth(request);
  const { id } = await params;

  const removed = await deleteNotes(id, user.id);
  return NextResponse.json({ removed }, { status: 200 });
}
```

- [ ] **Step 2: Verify the route compiles**

```bash
npm run typecheck
```

Expected: no errors related to `src/app/api/notes/[id]/route.ts`.

- [ ] **Step 3: Hit the endpoint manually**

Start the dev server in one terminal:

```bash
doppler run --project dissonance-cloud --config prd_loom -- npm run dev
```

In another terminal, log in via the browser at `http://localhost:3000/login`, then run a smoke check (replace `<MEDIA_OBJECT_ID>` with an existing audio media_object UUID — create one via the existing recordings init flow or insert directly into Supabase):

```bash
# Confirm GET returns empty body
curl -s -b cookies.txt http://localhost:3000/api/notes/<MEDIA_OBJECT_ID> | jq

# PUT with body
curl -s -b cookies.txt -X PUT \
  -H "Content-Type: application/json" \
  -d '{"body":"# Test\n\nHello world"}' \
  http://localhost:3000/api/notes/<MEDIA_OBJECT_ID> | jq

# GET to confirm persistence
curl -s -b cookies.txt http://localhost:3000/api/notes/<MEDIA_OBJECT_ID> | jq
```

Expected: GET first returns `{"body":""}`, PUT returns the upserted row, second GET returns the same body.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/notes/[id]/route.ts
git commit -m "feat(api): add /api/notes/[id] GET/PUT/DELETE for hand-typed notes"
```

---

### Task 8: `people` query module + API + tests

**Files:**
- Create: `src/db/queries/people.ts`
- Create: `src/app/api/people/route.ts`
- Create: `src/app/api/people/[id]/route.ts`
- Create: `tests/unit/people-queries.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/people-queries.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { db } from "@/db";
import { people } from "@/db/schema";
import {
  createPerson,
  listPeople,
  getPerson,
  updatePerson,
  deletePerson,
} from "@/db/queries/people";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

const OWNER_A = randomUUID();
const OWNER_B = randomUUID();

afterEach(async () => {
  await db.delete(people).where(eq(people.ownerId, OWNER_A));
  await db.delete(people).where(eq(people.ownerId, OWNER_B));
});

describe("people queries", () => {
  it("createPerson inserts a row scoped to owner", async () => {
    const p = await createPerson(OWNER_A, { displayName: "Aman", email: "aman@example.com" });
    expect(p.displayName).toBe("Aman");
    expect(p.ownerId).toBe(OWNER_A);
  });

  it("listPeople returns only the owner's rows", async () => {
    await createPerson(OWNER_A, { displayName: "Aman" });
    await createPerson(OWNER_A, { displayName: "Sara" });
    await createPerson(OWNER_B, { displayName: "Bob" });
    const list = await listPeople(OWNER_A);
    expect(list.length).toBe(2);
    expect(list.map(p => p.displayName).sort()).toEqual(["Aman", "Sara"]);
  });

  it("getPerson returns null for a different owner", async () => {
    const p = await createPerson(OWNER_A, { displayName: "Aman" });
    const result = await getPerson(p.id, OWNER_B);
    expect(result).toBeNull();
  });

  it("updatePerson updates display name and email", async () => {
    const p = await createPerson(OWNER_A, { displayName: "Aman" });
    const updated = await updatePerson(p.id, OWNER_A, {
      displayName: "Aman Patel",
      email: "aman@new.com",
    });
    expect(updated?.displayName).toBe("Aman Patel");
    expect(updated?.email).toBe("aman@new.com");
  });

  it("deletePerson removes the row", async () => {
    const p = await createPerson(OWNER_A, { displayName: "Aman" });
    const removed = await deletePerson(p.id, OWNER_A);
    expect(removed).toBe(true);
    const after = await getPerson(p.id, OWNER_A);
    expect(after).toBeNull();
  });

  it("deletePerson does NOT remove a different owner's row", async () => {
    const p = await createPerson(OWNER_A, { displayName: "Aman" });
    const removed = await deletePerson(p.id, OWNER_B);
    expect(removed).toBe(false);
    const after = await getPerson(p.id, OWNER_A);
    expect(after).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
doppler run --project dissonance-cloud --config prd_loom -- npm run test -- people-queries
```

Expected: FAIL with `Cannot find module '@/db/queries/people'`.

- [ ] **Step 3: Implement the query module**

Create `src/db/queries/people.ts`:

```ts
import { db } from "@/db";
import { people } from "@/db/schema";
import { and, eq, desc } from "drizzle-orm";

export type CreatePersonInput = {
  displayName: string;
  email?: string | null;
  notes?: string | null;
};

export async function createPerson(ownerId: string, input: CreatePersonInput) {
  const [row] = await db
    .insert(people)
    .values({
      ownerId,
      displayName: input.displayName,
      email: input.email ?? null,
      notes: input.notes ?? null,
    })
    .returning();
  return row;
}

export async function listPeople(ownerId: string) {
  return db
    .select()
    .from(people)
    .where(eq(people.ownerId, ownerId))
    .orderBy(desc(people.updatedAt));
}

export async function getPerson(id: string, ownerId: string) {
  const [row] = await db
    .select()
    .from(people)
    .where(and(eq(people.id, id), eq(people.ownerId, ownerId)))
    .limit(1);
  return row ?? null;
}

export async function updatePerson(
  id: string,
  ownerId: string,
  patch: Partial<CreatePersonInput>
) {
  const [row] = await db
    .update(people)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(people.id, id), eq(people.ownerId, ownerId)))
    .returning();
  return row ?? null;
}

export async function deletePerson(id: string, ownerId: string) {
  const result = await db
    .delete(people)
    .where(and(eq(people.id, id), eq(people.ownerId, ownerId)))
    .returning({ id: people.id });
  return result.length > 0;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
doppler run --project dissonance-cloud --config prd_loom -- npm run test -- people-queries
```

Expected: all 6 tests PASS.

- [ ] **Step 5: Implement the list/create endpoint**

Create `src/app/api/people/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/require-auth";
import { createPerson, listPeople } from "@/db/queries/people";

export async function GET(request: Request) {
  const user = await requireAuth(request);
  const list = await listPeople(user.id);
  return NextResponse.json(list, { status: 200 });
}

export async function POST(request: Request) {
  const user = await requireAuth(request);

  const json = await request.json().catch(() => null);
  if (!json || typeof json.displayName !== "string" || json.displayName.trim() === "") {
    return NextResponse.json({ error: "display_name_required" }, { status: 400 });
  }

  const row = await createPerson(user.id, {
    displayName: json.displayName,
    email: typeof json.email === "string" ? json.email : null,
    notes: typeof json.notes === "string" ? json.notes : null,
  });
  return NextResponse.json(row, { status: 201 });
}
```

- [ ] **Step 6: Implement the get/update/delete endpoint**

Create `src/app/api/people/[id]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/require-auth";
import { getPerson, updatePerson, deletePerson } from "@/db/queries/people";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth(request);
  const { id } = await params;
  const row = await getPerson(id, user.id);
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(row, { status: 200 });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth(request);
  const { id } = await params;

  const json = await request.json().catch(() => null);
  if (!json) return NextResponse.json({ error: "body_required" }, { status: 400 });

  const patch: { displayName?: string; email?: string | null; notes?: string | null } = {};
  if (typeof json.displayName === "string") patch.displayName = json.displayName;
  if ("email" in json) patch.email = typeof json.email === "string" ? json.email : null;
  if ("notes" in json) patch.notes = typeof json.notes === "string" ? json.notes : null;

  const row = await updatePerson(id, user.id, patch);
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(row, { status: 200 });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth(request);
  const { id } = await params;
  const removed = await deletePerson(id, user.id);
  return NextResponse.json({ removed }, { status: 200 });
}
```

- [ ] **Step 7: Verify both routes compile**

```bash
npm run typecheck
```

Expected: no errors related to `src/app/api/people/`.

- [ ] **Step 8: Commit**

```bash
git add src/db/queries/people.ts src/app/api/people/ tests/unit/people-queries.test.ts
git commit -m "feat(api): add people CRUD queries and endpoints"
```

---

### Task 9: `dictionary_terms` query module + API + tests

**Files:**
- Create: `src/db/queries/dictionary-terms.ts`
- Create: `src/app/api/dictionary-terms/route.ts`
- Create: `src/app/api/dictionary-terms/[id]/route.ts`
- Create: `tests/unit/dictionary-queries.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/dictionary-queries.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { db } from "@/db";
import { dictionaryTerms } from "@/db/schema";
import {
  createDictionaryTerm,
  listDictionaryTerms,
  updateDictionaryTerm,
  deleteDictionaryTerm,
  getCanonicalTerms,
} from "@/db/queries/dictionary-terms";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

const OWNER_A = randomUUID();
const OWNER_B = randomUUID();

afterEach(async () => {
  await db.delete(dictionaryTerms).where(eq(dictionaryTerms.ownerId, OWNER_A));
  await db.delete(dictionaryTerms).where(eq(dictionaryTerms.ownerId, OWNER_B));
});

describe("dictionary_terms queries", () => {
  it("createDictionaryTerm rejects duplicate (owner, term)", async () => {
    await createDictionaryTerm(OWNER_A, "Aman");
    await expect(createDictionaryTerm(OWNER_A, "Aman")).rejects.toThrow();
  });

  it("listDictionaryTerms returns only owner's rows", async () => {
    await createDictionaryTerm(OWNER_A, "Aman");
    await createDictionaryTerm(OWNER_A, "Sara");
    await createDictionaryTerm(OWNER_B, "Bob");
    const list = await listDictionaryTerms(OWNER_A);
    expect(list.length).toBe(2);
  });

  it("variantOf links to a canonical term", async () => {
    const canonical = await createDictionaryTerm(OWNER_A, "Aman");
    const variant = await createDictionaryTerm(OWNER_A, "Amaan", canonical.id);
    expect(variant.variantOf).toBe(canonical.id);
  });

  it("getCanonicalTerms returns canonicals only (variantOf IS NULL)", async () => {
    const canonical = await createDictionaryTerm(OWNER_A, "Aman");
    await createDictionaryTerm(OWNER_A, "Amaan", canonical.id);
    await createDictionaryTerm(OWNER_A, "Sara");
    const list = await getCanonicalTerms(OWNER_A);
    expect(list.length).toBe(2);
    expect(list.map(t => t.term).sort()).toEqual(["Aman", "Sara"]);
  });

  it("deleteDictionaryTerm removes the row", async () => {
    const t = await createDictionaryTerm(OWNER_A, "Aman");
    const removed = await deleteDictionaryTerm(t.id, OWNER_A);
    expect(removed).toBe(true);
  });

  it("updateDictionaryTerm changes term and variantOf", async () => {
    const c = await createDictionaryTerm(OWNER_A, "Aman");
    const v = await createDictionaryTerm(OWNER_A, "Amaan");
    const updated = await updateDictionaryTerm(v.id, OWNER_A, { variantOf: c.id });
    expect(updated?.variantOf).toBe(c.id);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
doppler run --project dissonance-cloud --config prd_loom -- npm run test -- dictionary-queries
```

Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Implement the query module**

Create `src/db/queries/dictionary-terms.ts`:

```ts
import { db } from "@/db";
import { dictionaryTerms } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";

export async function createDictionaryTerm(
  ownerId: string,
  term: string,
  variantOf?: string | null
) {
  const [row] = await db
    .insert(dictionaryTerms)
    .values({ ownerId, term, variantOf: variantOf ?? null })
    .returning();
  return row;
}

export async function listDictionaryTerms(ownerId: string) {
  return db
    .select()
    .from(dictionaryTerms)
    .where(eq(dictionaryTerms.ownerId, ownerId));
}

export async function getCanonicalTerms(ownerId: string) {
  return db
    .select()
    .from(dictionaryTerms)
    .where(
      and(
        eq(dictionaryTerms.ownerId, ownerId),
        isNull(dictionaryTerms.variantOf)
      )
    );
}

export async function updateDictionaryTerm(
  id: string,
  ownerId: string,
  patch: { term?: string; variantOf?: string | null }
) {
  const [row] = await db
    .update(dictionaryTerms)
    .set(patch)
    .where(and(eq(dictionaryTerms.id, id), eq(dictionaryTerms.ownerId, ownerId)))
    .returning();
  return row ?? null;
}

export async function deleteDictionaryTerm(id: string, ownerId: string) {
  const result = await db
    .delete(dictionaryTerms)
    .where(and(eq(dictionaryTerms.id, id), eq(dictionaryTerms.ownerId, ownerId)))
    .returning({ id: dictionaryTerms.id });
  return result.length > 0;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
doppler run --project dissonance-cloud --config prd_loom -- npm run test -- dictionary-queries
```

Expected: all 6 tests PASS.

- [ ] **Step 5: Implement the API endpoints**

Create `src/app/api/dictionary-terms/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/require-auth";
import {
  createDictionaryTerm,
  listDictionaryTerms,
} from "@/db/queries/dictionary-terms";

export async function GET(request: Request) {
  const user = await requireAuth(request);
  const list = await listDictionaryTerms(user.id);
  return NextResponse.json(list, { status: 200 });
}

export async function POST(request: Request) {
  const user = await requireAuth(request);

  const json = await request.json().catch(() => null);
  if (!json || typeof json.term !== "string" || json.term.trim() === "") {
    return NextResponse.json({ error: "term_required" }, { status: 400 });
  }

  try {
    const row = await createDictionaryTerm(
      user.id,
      json.term.trim(),
      typeof json.variantOf === "string" ? json.variantOf : null
    );
    return NextResponse.json(row, { status: 201 });
  } catch {
    return NextResponse.json({ error: "term_already_exists" }, { status: 409 });
  }
}
```

Create `src/app/api/dictionary-terms/[id]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/require-auth";
import {
  updateDictionaryTerm,
  deleteDictionaryTerm,
} from "@/db/queries/dictionary-terms";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth(request);
  const { id } = await params;

  const json = await request.json().catch(() => null);
  if (!json) return NextResponse.json({ error: "body_required" }, { status: 400 });

  const patch: { term?: string; variantOf?: string | null } = {};
  if (typeof json.term === "string") patch.term = json.term;
  if ("variantOf" in json) patch.variantOf = typeof json.variantOf === "string" ? json.variantOf : null;

  const row = await updateDictionaryTerm(id, user.id, patch);
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(row, { status: 200 });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireAuth(request);
  const { id } = await params;
  const removed = await deleteDictionaryTerm(id, user.id);
  return NextResponse.json({ removed }, { status: 200 });
}
```

- [ ] **Step 6: Verify routes compile**

```bash
npm run typecheck
```

Expected: no errors related to dictionary-terms files.

- [ ] **Step 7: Commit**

```bash
git add src/db/queries/dictionary-terms.ts src/app/api/dictionary-terms/ tests/unit/dictionary-queries.test.ts
git commit -m "feat(api): add dictionary_terms CRUD queries and endpoints"
```

---

### Task 10: `speaker_assignments` query module + API + tests

**Files:**
- Create: `src/db/queries/speaker-assignments.ts`
- Create: `src/app/api/speaker-assignments/[mediaId]/route.ts`
- Create: `tests/unit/speaker-assignments.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/speaker-assignments.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { db } from "@/db";
import { mediaObjects, people, speakerAssignments } from "@/db/schema";
import {
  upsertSpeakerAssignment,
  listSpeakerAssignments,
  deleteSpeakerAssignment,
} from "@/db/queries/speaker-assignments";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

const OWNER_A = randomUUID();
const OWNER_B = randomUUID();

async function createMedia(ownerId: string) {
  const [m] = await db.insert(mediaObjects).values({
    ownerId,
    type: "audio",
    slug: `t-${randomUUID().slice(0, 8)}`,
    status: "ready",
  }).returning();
  return m;
}

afterEach(async () => {
  await db.delete(mediaObjects).where(eq(mediaObjects.ownerId, OWNER_A));
  await db.delete(mediaObjects).where(eq(mediaObjects.ownerId, OWNER_B));
  await db.delete(people).where(eq(people.ownerId, OWNER_A));
  await db.delete(people).where(eq(people.ownerId, OWNER_B));
});

describe("speaker_assignments queries", () => {
  it("upsertSpeakerAssignment links speakerIdx to a person", async () => {
    const m = await createMedia(OWNER_A);
    const [p] = await db.insert(people).values({ ownerId: OWNER_A, displayName: "Aman" }).returning();
    const r = await upsertSpeakerAssignment({
      mediaObjectId: m.id,
      ownerId: OWNER_A,
      speakerIdx: 0,
      personId: p.id,
    });
    expect(r.personId).toBe(p.id);
    expect(r.displayLabelOverride).toBeNull();
  });

  it("upsertSpeakerAssignment supports a one-off display label", async () => {
    const m = await createMedia(OWNER_A);
    const r = await upsertSpeakerAssignment({
      mediaObjectId: m.id,
      ownerId: OWNER_A,
      speakerIdx: 1,
      displayLabelOverride: "Customer A",
    });
    expect(r.personId).toBeNull();
    expect(r.displayLabelOverride).toBe("Customer A");
  });

  it("upsertSpeakerAssignment overwrites the same speakerIdx", async () => {
    const m = await createMedia(OWNER_A);
    const [p1] = await db.insert(people).values({ ownerId: OWNER_A, displayName: "Aman" }).returning();
    const [p2] = await db.insert(people).values({ ownerId: OWNER_A, displayName: "Sara" }).returning();
    await upsertSpeakerAssignment({ mediaObjectId: m.id, ownerId: OWNER_A, speakerIdx: 0, personId: p1.id });
    await upsertSpeakerAssignment({ mediaObjectId: m.id, ownerId: OWNER_A, speakerIdx: 0, personId: p2.id });
    const list = await listSpeakerAssignments(m.id, OWNER_A);
    expect(list.length).toBe(1);
    expect(list[0].personId).toBe(p2.id);
  });

  it("upsertSpeakerAssignment rejects when neither personId nor displayLabelOverride provided", async () => {
    const m = await createMedia(OWNER_A);
    await expect(
      upsertSpeakerAssignment({ mediaObjectId: m.id, ownerId: OWNER_A, speakerIdx: 0 })
    ).rejects.toThrow();
  });

  it("upsertSpeakerAssignment rejects when ownerId doesn't match media_object owner", async () => {
    const m = await createMedia(OWNER_A);
    await expect(
      upsertSpeakerAssignment({ mediaObjectId: m.id, ownerId: OWNER_B, speakerIdx: 0, displayLabelOverride: "X" })
    ).rejects.toThrow();
  });

  it("listSpeakerAssignments returns rows scoped to the meeting", async () => {
    const m = await createMedia(OWNER_A);
    const [p] = await db.insert(people).values({ ownerId: OWNER_A, displayName: "Aman" }).returning();
    await upsertSpeakerAssignment({ mediaObjectId: m.id, ownerId: OWNER_A, speakerIdx: 0, personId: p.id });
    await upsertSpeakerAssignment({ mediaObjectId: m.id, ownerId: OWNER_A, speakerIdx: 1, displayLabelOverride: "X" });
    const list = await listSpeakerAssignments(m.id, OWNER_A);
    expect(list.length).toBe(2);
  });

  it("deleteSpeakerAssignment removes a single (mediaObject, speakerIdx)", async () => {
    const m = await createMedia(OWNER_A);
    await upsertSpeakerAssignment({ mediaObjectId: m.id, ownerId: OWNER_A, speakerIdx: 0, displayLabelOverride: "X" });
    const removed = await deleteSpeakerAssignment(m.id, OWNER_A, 0);
    expect(removed).toBe(true);
    const list = await listSpeakerAssignments(m.id, OWNER_A);
    expect(list.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
doppler run --project dissonance-cloud --config prd_loom -- npm run test -- speaker-assignments
```

Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Implement the query module**

Create `src/db/queries/speaker-assignments.ts`:

```ts
import { db } from "@/db";
import { speakerAssignments, mediaObjects } from "@/db/schema";
import { and, eq } from "drizzle-orm";

export type UpsertSpeakerAssignmentInput = {
  mediaObjectId: string;
  ownerId: string;
  speakerIdx: number;
  personId?: string | null;
  displayLabelOverride?: string | null;
};

export async function upsertSpeakerAssignment(input: UpsertSpeakerAssignmentInput) {
  if (!input.personId && !input.displayLabelOverride) {
    throw new Error("either personId or displayLabelOverride is required");
  }

  // Verify media_object ownership.
  const [media] = await db
    .select({ id: mediaObjects.id, ownerId: mediaObjects.ownerId })
    .from(mediaObjects)
    .where(eq(mediaObjects.id, input.mediaObjectId))
    .limit(1);
  if (!media || media.ownerId !== input.ownerId) {
    throw new Error("media_object not found or not owned by user");
  }

  const [row] = await db
    .insert(speakerAssignments)
    .values({
      mediaObjectId: input.mediaObjectId,
      speakerIdx: input.speakerIdx,
      personId: input.personId ?? null,
      displayLabelOverride: input.displayLabelOverride ?? null,
    })
    .onConflictDoUpdate({
      target: [speakerAssignments.mediaObjectId, speakerAssignments.speakerIdx],
      set: {
        personId: input.personId ?? null,
        displayLabelOverride: input.displayLabelOverride ?? null,
      },
    })
    .returning();
  return row;
}

export async function listSpeakerAssignments(
  mediaObjectId: string,
  ownerId: string
) {
  // Ownership check via JOIN to media_objects.
  const rows = await db
    .select({ assignment: speakerAssignments })
    .from(speakerAssignments)
    .innerJoin(mediaObjects, eq(mediaObjects.id, speakerAssignments.mediaObjectId))
    .where(
      and(
        eq(speakerAssignments.mediaObjectId, mediaObjectId),
        eq(mediaObjects.ownerId, ownerId)
      )
    );
  return rows.map(r => r.assignment);
}

export async function deleteSpeakerAssignment(
  mediaObjectId: string,
  ownerId: string,
  speakerIdx: number
) {
  // Verify media_object ownership before deleting.
  const [media] = await db
    .select({ id: mediaObjects.id, ownerId: mediaObjects.ownerId })
    .from(mediaObjects)
    .where(eq(mediaObjects.id, mediaObjectId))
    .limit(1);
  if (!media || media.ownerId !== ownerId) return false;

  const result = await db
    .delete(speakerAssignments)
    .where(
      and(
        eq(speakerAssignments.mediaObjectId, mediaObjectId),
        eq(speakerAssignments.speakerIdx, speakerIdx)
      )
    )
    .returning({ id: speakerAssignments.id });
  return result.length > 0;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
doppler run --project dissonance-cloud --config prd_loom -- npm run test -- speaker-assignments
```

Expected: all 7 tests PASS.

- [ ] **Step 5: Implement the API endpoint**

Create `src/app/api/speaker-assignments/[mediaId]/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/require-auth";
import {
  upsertSpeakerAssignment,
  listSpeakerAssignments,
  deleteSpeakerAssignment,
} from "@/db/queries/speaker-assignments";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ mediaId: string }> }
) {
  const user = await requireAuth(request);
  const { mediaId } = await params;
  const list = await listSpeakerAssignments(mediaId, user.id);
  return NextResponse.json(list, { status: 200 });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ mediaId: string }> }
) {
  const user = await requireAuth(request);
  const { mediaId } = await params;

  const json = await request.json().catch(() => null);
  if (
    !json ||
    typeof json.speakerIdx !== "number" ||
    (typeof json.personId !== "string" && typeof json.displayLabelOverride !== "string")
  ) {
    return NextResponse.json({ error: "speaker_assignment_invalid" }, { status: 400 });
  }

  try {
    const row = await upsertSpeakerAssignment({
      mediaObjectId: mediaId,
      ownerId: user.id,
      speakerIdx: json.speakerIdx,
      personId: typeof json.personId === "string" ? json.personId : null,
      displayLabelOverride:
        typeof json.displayLabelOverride === "string" ? json.displayLabelOverride : null,
    });
    return NextResponse.json(row, { status: 200 });
  } catch {
    return NextResponse.json({ error: "speaker_assignment_invalid" }, { status: 400 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ mediaId: string }> }
) {
  const user = await requireAuth(request);
  const { mediaId } = await params;

  const url = new URL(request.url);
  const speakerIdxStr = url.searchParams.get("speakerIdx");
  if (!speakerIdxStr) {
    return NextResponse.json({ error: "speaker_idx_required" }, { status: 400 });
  }
  const speakerIdx = Number(speakerIdxStr);
  if (!Number.isInteger(speakerIdx)) {
    return NextResponse.json({ error: "speaker_idx_invalid" }, { status: 400 });
  }

  const removed = await deleteSpeakerAssignment(mediaId, user.id, speakerIdx);
  return NextResponse.json({ removed }, { status: 200 });
}
```

- [ ] **Step 6: Verify the route compiles**

```bash
npm run typecheck
```

Expected: no errors related to speaker-assignments files.

- [ ] **Step 7: Commit**

```bash
git add src/db/queries/speaker-assignments.ts src/app/api/speaker-assignments/ tests/unit/speaker-assignments.test.ts
git commit -m "feat(api): add speaker_assignments queries and endpoint"
```

---

### Task 11: Add new env vars to Doppler

**Files:**
- Modify: `.env.example` (add documentation entries)

- [ ] **Step 1: Add the env vars to Doppler**

Run these commands. The user will be prompted to enter values interactively (or paste from a password manager).

```bash
doppler secrets set OPENAI_API_KEY --project dissonance-cloud --config prd_loom
doppler secrets set INTEGRATION_API_TOKEN --project dissonance-cloud --config prd_loom
doppler secrets set EMBEDDING_PROVIDER=openai --project dissonance-cloud --config prd_loom
doppler secrets set LLM_PROVIDER=openrouter --project dissonance-cloud --config prd_loom
doppler secrets set LLM_MODEL=anthropic/claude-sonnet-4.6 --project dissonance-cloud --config prd_loom
doppler secrets set TRANSCRIBE_PROVIDER=deepgram --project dissonance-cloud --config prd_loom
```

Generate `INTEGRATION_API_TOKEN` with a tool like `openssl rand -hex 32` or `pwgen -s 64 1` and paste when prompted. Save it in your password manager — you'll need it for testing the Layer 2 export endpoints in M11.

For `OPENAI_API_KEY`, use a key from platform.openai.com (used for `text-embedding-3-small` only in MVP).

`OPENROUTER_API_KEY` should already exist in Doppler from the existing Loom setup. If not, set it the same way:

```bash
doppler secrets set OPENROUTER_API_KEY --project dissonance-cloud --config prd_loom
```

- [ ] **Step 2: Verify all env vars are present**

```bash
doppler secrets --project dissonance-cloud --config prd_loom --only-names | grep -E "OPENAI_API_KEY|INTEGRATION_API_TOKEN|EMBEDDING_PROVIDER|LLM_PROVIDER|LLM_MODEL|TRANSCRIBE_PROVIDER|OPENROUTER_API_KEY"
```

Expected: all 7 names listed.

- [ ] **Step 3: Update `.env.example` with documentation**

Read `.env.example`, then append (preserving existing entries):

```bash
cat >> .env.example <<'EOF'

# Granola-alt — added in M1
OPENAI_API_KEY=sk-...
OPENROUTER_API_KEY=sk-or-v1-...
INTEGRATION_API_TOKEN=...                     # bearer token for /api/notes/:id/export.json + /api/export/bundle.zip (M11)
EMBEDDING_PROVIDER=openai                     # default; alternatives: voyage, cohere, local-ollama
LLM_PROVIDER=openrouter                       # default; alternatives: anthropic, openai, google, ollama
LLM_MODEL=anthropic/claude-sonnet-4.6         # OpenRouter route, or direct provider model name
TRANSCRIBE_PROVIDER=deepgram                  # default; alternatives: whisper-local, assemblyai, speechmatics
EOF
```

- [ ] **Step 4: Commit**

```bash
git add .env.example
git commit -m "feat(env): document granola-alt env vars in .env.example"
```

---

### Task 12: End-to-end smoke test

**Files:**
- Create: `tests/e2e/granola-m1-smoke.spec.ts`

- [ ] **Step 1: Write the smoke test**

Create `tests/e2e/granola-m1-smoke.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

const TEST_EMAIL = process.env.TEST_CREATOR_EMAIL;
const TEST_PASSWORD = process.env.TEST_CREATOR_PASSWORD;

test.describe("Granola M1 — schema foundations smoke", () => {
  test.skip(
    !TEST_EMAIL || !TEST_PASSWORD,
    "requires TEST_CREATOR_EMAIL + TEST_CREATOR_PASSWORD env vars"
  );

  test.beforeEach(async ({ page }) => {
    // Match the existing E2E sign-in pattern (see tests/e2e/auth.spec.ts).
    await page.goto("/login");
    await page.getByLabel("Email").fill(TEST_EMAIL!);
    await page.getByLabel("Password").fill(TEST_PASSWORD!);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL("/");
  });

  test("people CRUD round-trip via API", async ({ page }) => {
    const createResp = await page.request.post("/api/people", {
      data: { displayName: "M1 Smoke Person", email: "smoke@example.com" },
    });
    expect(createResp.ok()).toBe(true);
    const created = await createResp.json();
    expect(created.displayName).toBe("M1 Smoke Person");

    const listResp = await page.request.get("/api/people");
    expect(listResp.ok()).toBe(true);
    const list: Array<{ id: string }> = await listResp.json();
    expect(list.find((p) => p.id === created.id)).toBeTruthy();

    const patchResp = await page.request.patch(`/api/people/${created.id}`, {
      data: { displayName: "M1 Smoke Renamed" },
    });
    expect(patchResp.ok()).toBe(true);
    const patched = await patchResp.json();
    expect(patched.displayName).toBe("M1 Smoke Renamed");

    const delResp = await page.request.delete(`/api/people/${created.id}`);
    expect(delResp.ok()).toBe(true);
  });

  test("dictionary terms CRUD round-trip via API", async ({ page }) => {
    const term = `M1Smoke-${Date.now()}`;
    const createResp = await page.request.post("/api/dictionary-terms", {
      data: { term },
    });
    expect(createResp.ok()).toBe(true);
    const created = await createResp.json();

    const listResp = await page.request.get("/api/dictionary-terms");
    const list: Array<{ id: string; term: string }> = await listResp.json();
    expect(list.find((t) => t.id === created.id)).toBeTruthy();

    const delResp = await page.request.delete(`/api/dictionary-terms/${created.id}`);
    expect(delResp.ok()).toBe(true);
  });
});
```

**Note:** The notes API endpoint requires an existing `media_objects` row of `type='audio'`. Creating one via HTTP requires changes to `/api/recordings/init` that don't land until M2. For M1, the notes round-trip is fully covered by unit tests in Task 6 (which seed media_objects directly via the `db` driver). The notes round-trip is added to the E2E smoke in M2 once audio init is wired.

- [ ] **Step 2: Run the smoke test**

In one terminal:

```bash
doppler run --project dissonance-cloud --config prd_loom -- npm run dev
```

In another terminal:

```bash
doppler run --project dissonance-cloud --config prd_loom -- npx playwright test granola-m1-smoke
```

Expected: 3 tests PASS.

If `/auth/sign-in` doesn't exist as a POST endpoint, sign in via `page.goto('/login')` + form submission. Adjust the `beforeAll` accordingly.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/granola-m1-smoke.spec.ts
git commit -m "test(e2e): smoke test for granola M1 — notes/people/dictionary round-trips"
```

---

### Task 13: Update CLAUDE.md and ROADMAP.md

**Files:**
- Modify: `CLAUDE.md`
- Modify: `ROADMAP.md`

- [ ] **Step 1: Add Granola-alt M1 status to ROADMAP.md**

Read `ROADMAP.md` and add a new section after the existing "Stage 1.9 — Chrome extension companion" section, before "Open follow-ups (next milestones to spec)":

```markdown
## Granola-alt — Audio meeting notes (in progress)

Self-hosted Granola clone built as a second surface on top of the existing Loom_Clone backend. Spec: [`docs/superpowers/specs/2026-04-28-granola-clone-design.md`](docs/superpowers/specs/2026-04-28-granola-clone-design.md). Per-milestone plans under `docs/superpowers/plans/`.

| # | Milestone | Status | What it ships |
|---|---|---|---|
| G-M1 | Schema foundations + notes API | ✅ shipped | pgvector extension, six new tables (notes, people, speaker_assignments, dictionary_terms, transcript_chunks, summary_embeddings), four extended tables (media_objects, transcripts, ai_outputs, brand_profiles), RLS policies, Realtime publication on ai_outputs, thin CRUD API for each new entity |
| G-M2 | Audio ingest pipeline | 🔜 next | Backend changes for audio-only media_objects, ffmpeg mic+system mixing, audio_waveform job |
| G-M3 | Desktop app — manual recording trigger | 📋 spec'd | Swift menubar item to manually start a recording, ScreenCaptureKit + AVFoundation capture, multipart upload as type='audio' |
| G-M4 | /notes/:id Granola UI | 📋 spec'd | Single-column markdown canvas, metadata pill row, persistent bottom strip, floating transcript card |
| G-M5 | Tabbed dashboard | 📋 spec'd | / becomes Recordings \| Notes tabs, shared sidebar |
| G-M6 | Speaker labeling MVP | 📋 spec'd | /people page, attendee picker, speaker chip popover, persistence |
| G-M7 | Shared dictionary | 📋 spec'd | /dictionary page, Deepgram keyterms wiring |
| G-M8 | pgvector embedding-on-write | 📋 spec'd | embed_transcript and embed_summary jobs |
| G-M9 | AI enhancement (user-triggered, streaming) | 📋 spec'd | "Generate notes" trigger, streamText + Realtime, "Enhancing notes" pill UX |
| G-M10 | Per-project Obsidian sync | 📋 spec'd | brand_profiles vault path, manual save flow, desktop writer |
| G-M11 | LLM-accessible API + meeting detection | 📋 spec'd | INTEGRATION_API_TOKEN, JSON/zip export endpoints, NSWorkspace meeting detection, Chrome extension content scripts, auto-arm UX |
```

- [ ] **Step 2: Add a Granola-alt section to CLAUDE.md**

Read `CLAUDE.md` and add a new section just before the "Out-of-Stage-1 Scope" section:

```markdown
## Granola-alt (in progress)

A second product (audio meeting notes) built on top of this same backend. Spec: [`docs/superpowers/specs/2026-04-28-granola-clone-design.md`](docs/superpowers/specs/2026-04-28-granola-clone-design.md).

- **G-M1 shipped** (this milestone): six new Postgres tables (`notes`, `people`, `speaker_assignments`, `dictionary_terms`, `transcript_chunks`, `summary_embeddings`), four extended tables (`media_objects`, `transcripts`, `ai_outputs`, `brand_profiles`), pgvector extension, RLS policies, Supabase Realtime publication on `ai_outputs`, thin CRUD API for the new entities.
- **Schema additions you'll see**: `media_objects.attendees` (jsonb of person UUIDs), `media_objects.r2MixedKey` (mic+system mixed mono audio), `media_objects.meetingDetectedApp`, `media_objects.obsidianSyncedAt`, `transcripts.provider` (default 'deepgram'), `ai_outputs.generationStatus` enum (`pending|streaming|complete|failed`), `brand_profiles.meetingNotesVaultPath`.
- **No UI yet** — that lands in G-M4 (`/notes/:id`) and G-M5 (tabbed dashboard).
- **Provider abstraction**: env vars `LLM_PROVIDER`, `LLM_MODEL`, `EMBEDDING_PROVIDER`, `TRANSCRIBE_PROVIDER` allow swapping providers without code changes.
- **`INTEGRATION_API_TOKEN`**: bearer token for upcoming LLM-accessible export endpoints (lands in G-M11). Do NOT expose this in client code; server-only.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md ROADMAP.md
git commit -m "docs: add granola-alt M1 to roadmap and project notes"
```

---

### Task 14: Verify deploy + production migration

**Files:**
- (no source changes)

- [ ] **Step 1: Push to main**

```bash
git push origin main
```

Coolify auto-deploys on push. Wait for the build to complete (~3-5 minutes).

- [ ] **Step 2: Verify migration ran in production**

Visit https://loom.dissonance.cloud and confirm the app loads. Check the Coolify logs for the boot output — should include a `migrations applied` line.

Then verify the production database has the new tables:

```bash
doppler run --project dissonance-cloud --config prd_loom -- node -e "
  const postgres = require('postgres');
  const sql = postgres(process.env.DATABASE_URL);
  Promise.all([
    sql\`SELECT to_regclass('public.notes') as t\`,
    sql\`SELECT to_regclass('public.people') as t\`,
    sql\`SELECT extname FROM pg_extension WHERE extname='vector'\`,
    sql\`SELECT pubname FROM pg_publication_tables WHERE tablename='ai_outputs'\`,
  ]).then(([n, p, v, pub]) => {
    console.log('notes:', n[0].t);
    console.log('people:', p[0].t);
    console.log('vector ext:', v.length === 1 ? 'INSTALLED' : 'MISSING');
    console.log('ai_outputs in publication:', pub.length === 1 ? 'YES' : 'NO');
    return sql.end();
  });
"
```

Expected: all four lines confirm OK.

- [ ] **Step 3: Run the smoke test against production**

```bash
PLAYWRIGHT_BASE_URL=https://loom.dissonance.cloud \
  doppler run --project dissonance-cloud --config prd_loom -- \
  npx playwright test granola-m1-smoke
```

Expected: 3 tests PASS against production.

- [ ] **Step 4: Mark M1 complete in ROADMAP.md**

(Already done in Task 13 — this step is just confirmation that the status badge is correct.)

---

## Definition of Done

M1 is complete when:

1. ✅ All migrations (0010, 0011, 0012, 0013) have run cleanly in dev and production.
2. ✅ All six new tables exist with RLS enabled.
3. ✅ pgvector extension is installed and HNSW indices exist on the two embedding columns.
4. ✅ `ai_outputs` is in the `supabase_realtime` publication.
5. ✅ All four query modules pass their Vitest suites (`npm run test` reports green for the four new test files).
6. ✅ All five CRUD endpoints (`/api/notes/[id]`, `/api/people`, `/api/people/[id]`, `/api/dictionary-terms`, `/api/dictionary-terms/[id]`, `/api/speaker-assignments/[mediaId]`) are reachable, authenticated, and ownership-respecting.
7. ✅ The E2E smoke test passes against the production URL.
8. ✅ Doppler has `OPENAI_API_KEY`, `INTEGRATION_API_TOKEN`, `EMBEDDING_PROVIDER`, `LLM_PROVIDER`, `LLM_MODEL`, `TRANSCRIBE_PROVIDER` set.
9. ✅ ROADMAP and CLAUDE.md updated; M1 row marked shipped.

After M1 is verified live, re-invoke `superpowers:writing-plans` to write M2 (audio ingest pipeline).
