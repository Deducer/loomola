-- Phase 1 of multi-folder migration. Spec:
--   docs/superpowers/specs/2026-05-06-multi-folder-assignments-design.md
--
-- Adds the join table without touching the legacy
-- `media_objects.folder_id` column. Subsequent app code dual-writes
-- both. The read flip + column drop are separate later phases.

CREATE TABLE IF NOT EXISTS "media_folder_assignments" (
  "media_object_id" uuid NOT NULL,
  "folder_id" uuid NOT NULL,
  "owner_id" uuid NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "media_folder_assignments_pkey"
    PRIMARY KEY ("media_object_id", "folder_id"),
  CONSTRAINT "media_folder_assignments_media_object_id_fkey"
    FOREIGN KEY ("media_object_id")
    REFERENCES "media_objects"("id") ON DELETE CASCADE,
  CONSTRAINT "media_folder_assignments_folder_id_fkey"
    FOREIGN KEY ("folder_id")
    REFERENCES "folders"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_folder_assignments_folder_idx"
  ON "media_folder_assignments" USING btree ("folder_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_folder_assignments_owner_media_idx"
  ON "media_folder_assignments" USING btree ("owner_id", "media_object_id");
--> statement-breakpoint
ALTER TABLE "media_folder_assignments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Owner-scoped full access; matches the pattern from 0001_rls_and_auth_fk
-- for media_objects + brand_profiles.
CREATE POLICY "media_folder_assignments_owner_all" ON "media_folder_assignments"
  FOR ALL
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);
--> statement-breakpoint
-- Backfill from the existing single-folder column. Idempotent via
-- the composite PK + ON CONFLICT — re-running this migration would
-- silently no-op rather than error.
INSERT INTO "media_folder_assignments" ("media_object_id", "folder_id", "owner_id", "created_at")
SELECT
  m."id",
  m."folder_id",
  m."owner_id",
  COALESCE(m."updated_at", m."created_at", now())
FROM "media_objects" m
WHERE m."folder_id" IS NOT NULL
  AND m."deleted_at" IS NULL
ON CONFLICT ("media_object_id", "folder_id") DO NOTHING;
