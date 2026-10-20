-- Replace the partial import-source unique indexes on people and folders
-- with full (non-partial) ones.
--
-- Why: the Granola import route inserts with
--   ON CONFLICT (owner_id, import_source, import_source_id) DO NOTHING
-- and Postgres only infers a partial unique index when the ON CONFLICT
-- clause repeats the index predicate. Without it, the insert fails with
-- 42P10 "there is no unique or exclusion constraint matching the ON
-- CONFLICT specification" (seen in production 2026-10-20). A full unique
-- index is inferred by the bare column list. Native rows keep NULL
-- import_source, and NULLs are distinct in a unique index, so they are
-- unaffected. media_objects keeps its partial index: that path does a
-- select-then-insert and never uses ON CONFLICT.
--
-- Applied to production by hand (CONCURRENTLY) on 2026-10-20; every
-- statement here is idempotent so the boot-time migrator is a no-op there.

CREATE UNIQUE INDEX IF NOT EXISTS "people_import_source_unique"
  ON "people" ("owner_id", "import_source", "import_source_id");
--> statement-breakpoint
DROP INDEX IF EXISTS "people_import_source_uniq";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "folders_import_source_unique"
  ON "folders" ("owner_id", "import_source", "import_source_id");
--> statement-breakpoint
DROP INDEX IF EXISTS "folders_import_source_uniq";
