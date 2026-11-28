-- Stage 25: Frame.io-style review comments and version stacks.
-- Everything is additive and nullable, so old rows and old builds keep working.
--
-- comments: a range end, a pin/drawing on the frame (fractions 0-1 of the
-- displayed frame, validated by Zod on write), one level of replies, and an
-- owner-set resolved stamp.
ALTER TABLE "comments" ADD COLUMN IF NOT EXISTS "end_sec" numeric;
--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN IF NOT EXISTS "annotation" jsonb;
--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN IF NOT EXISTS "parent_id" uuid REFERENCES "comments"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN IF NOT EXISTS "resolved_at" timestamp with time zone;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "comments_parent_id_idx" ON "comments" ("parent_id");
--> statement-breakpoint
-- media_objects: probed frame rate (frame-accurate timecodes), and version
-- stacks. A stack is the rows sharing version_group_id (the id of the first
-- version); version_number orders them. Null group = a stack of one.
ALTER TABLE "media_objects" ADD COLUMN IF NOT EXISTS "fps" numeric;
--> statement-breakpoint
ALTER TABLE "media_objects" ADD COLUMN IF NOT EXISTS "version_group_id" uuid;
--> statement-breakpoint
ALTER TABLE "media_objects" ADD COLUMN IF NOT EXISTS "version_number" integer;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "media_objects_version_group_number_uniq" ON "media_objects" ("version_group_id", "version_number") WHERE "version_group_id" IS NOT NULL;
