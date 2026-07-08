-- drizzle-kit's diff for this migration re-emitted DDL from stages 7-11
-- (invites, media_folder_assignments, note_attachments, ...) because the
-- meta snapshots lagged behind hand-authored migrations 0022-0027; the
-- 0028 snapshot now reflects the full live schema. Only the genuinely new
-- statements are kept — everything else already exists in prod and would
-- fail at boot.
ALTER TABLE "folders" ADD COLUMN "is_favorite" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "folders" ADD COLUMN "icon" text;
