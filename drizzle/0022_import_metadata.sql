-- Import metadata: lays the slot for the Granola/Loom migration tools.
-- Spec: docs/superpowers/specs/2026-05-06-granola-migration-tool-design.md
--
-- Three columns added to each of media_objects, people, folders so a
-- migration tool can dedupe by the upstream system's own UUID. The
-- partial unique index per (owner_id, import_source, import_source_id)
-- where import_source IS NOT NULL is the dedup key for merge-idempotent
-- imports. Native (non-imported) rows have NULL import_source and don't
-- participate in the unique constraint.

ALTER TABLE "media_objects"
  ADD COLUMN "import_source" text,
  ADD COLUMN "import_source_id" text,
  ADD CONSTRAINT "media_objects_import_source_check"
    CHECK ("import_source" IS NULL OR "import_source" IN ('loom', 'granola'));
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "media_objects_import_source_uniq"
  ON "media_objects" ("owner_id", "import_source", "import_source_id")
  WHERE "import_source" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "people"
  ADD COLUMN "import_source" text,
  ADD COLUMN "import_source_id" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "people_import_source_uniq"
  ON "people" ("owner_id", "import_source", "import_source_id")
  WHERE "import_source" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "folders"
  ADD COLUMN "import_source" text,
  ADD COLUMN "import_source_id" text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "folders_import_source_uniq"
  ON "folders" ("owner_id", "import_source", "import_source_id")
  WHERE "import_source" IS NOT NULL;
