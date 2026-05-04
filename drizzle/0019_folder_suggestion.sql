ALTER TABLE "media_objects"
  ADD COLUMN "suggested_folder_id" uuid REFERENCES "folders"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "media_objects"
  ADD COLUMN "suggested_folder_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "media_objects"
  ADD COLUMN "suggested_folder_dismissed_at" timestamp with time zone;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_objects_suggested_folder_idx"
  ON "media_objects" USING btree ("owner_id", "suggested_folder_id")
  WHERE "suggested_folder_id" IS NOT NULL;
