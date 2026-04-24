CREATE TABLE "folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_outputs" ADD COLUMN "search_tsv" "tsvector";--> statement-breakpoint
ALTER TABLE "media_objects" ADD COLUMN "folder_id" uuid;--> statement-breakpoint
ALTER TABLE "media_objects" ADD COLUMN "search_tsv" "tsvector";--> statement-breakpoint
ALTER TABLE "transcripts" ADD COLUMN "search_tsv" "tsvector";--> statement-breakpoint
CREATE INDEX "folders_owner_idx" ON "folders" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "folders_parent_idx" ON "folders" USING btree ("parent_id");
--> Convert search_tsv columns to generated stored columns with weighted vectors.
--> statement-breakpoint
ALTER TABLE "media_objects" DROP COLUMN IF EXISTS "search_tsv";
--> statement-breakpoint
ALTER TABLE "media_objects" ADD COLUMN "search_tsv" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A')
  ) STORED;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_objects_search_tsv_idx"
  ON "media_objects" USING GIN ("search_tsv");
--> statement-breakpoint
ALTER TABLE "ai_outputs" DROP COLUMN IF EXISTS "search_tsv";
--> statement-breakpoint
ALTER TABLE "ai_outputs" ADD COLUMN "search_tsv" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title_suggested, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(summary, '')), 'B')
  ) STORED;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_outputs_search_tsv_idx"
  ON "ai_outputs" USING GIN ("search_tsv");
--> statement-breakpoint
ALTER TABLE "transcripts" DROP COLUMN IF EXISTS "search_tsv";
--> statement-breakpoint
ALTER TABLE "transcripts" ADD COLUMN "search_tsv" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(full_text, '')), 'C')
  ) STORED;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transcripts_search_tsv_idx"
  ON "transcripts" USING GIN ("search_tsv");
--> statement-breakpoint
ALTER TABLE "folders"
  ADD CONSTRAINT "folders_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "folders"
  ADD CONSTRAINT "folders_parent_id_fkey"
  FOREIGN KEY ("parent_id") REFERENCES "folders"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE UNIQUE INDEX "folders_unique_sibling_name"
  ON "folders"("owner_id", COALESCE("parent_id", '00000000-0000-0000-0000-000000000000'::uuid), "name");
--> statement-breakpoint
ALTER TABLE "media_objects"
  ADD CONSTRAINT "media_objects_folder_id_fkey"
  FOREIGN KEY ("folder_id") REFERENCES "folders"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "media_objects_folder_id_idx" ON "media_objects"("folder_id");
