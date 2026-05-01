CREATE TYPE "public"."generation_status" AS ENUM('pending', 'streaming', 'complete', 'failed');
--> statement-breakpoint
CREATE TABLE "dictionary_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"term" text NOT NULL,
	"variant_of" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"media_object_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"email" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "speaker_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"media_object_id" uuid NOT NULL,
	"speaker_idx" integer NOT NULL,
	"person_id" uuid,
	"display_label_override" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "summary_embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"media_object_id" uuid NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"model_version" text DEFAULT 'openai/text-embedding-3-small' NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "summary_embeddings_media_object_id_unique" UNIQUE("media_object_id")
);
--> statement-breakpoint
CREATE TABLE "transcript_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"media_object_id" uuid NOT NULL,
	"chunk_idx" integer NOT NULL,
	"text" text NOT NULL,
	"start_ms" integer NOT NULL,
	"end_ms" integer NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"model_version" text DEFAULT 'openai/text-embedding-3-small' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_outputs" ADD COLUMN "template_id" text DEFAULT 'default' NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_outputs" ADD COLUMN "generation_status" "generation_status" DEFAULT 'complete' NOT NULL;
--> statement-breakpoint
ALTER TABLE "brand_profiles" ADD COLUMN "meeting_notes_vault_path" text;
--> statement-breakpoint
ALTER TABLE "media_objects" ADD COLUMN "meeting_detected_app" text;
--> statement-breakpoint
ALTER TABLE "media_objects" ADD COLUMN "meeting_started_at_local" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "media_objects" ADD COLUMN "attendees" jsonb;
--> statement-breakpoint
ALTER TABLE "media_objects" ADD COLUMN "r2_mixed_key" text;
--> statement-breakpoint
ALTER TABLE "media_objects" ADD COLUMN "obsidian_save_requested_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "media_objects" ADD COLUMN "obsidian_synced_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "media_objects" ADD COLUMN "source_context_hint" text;
--> statement-breakpoint
ALTER TABLE "transcripts" ADD COLUMN "provider" text DEFAULT 'deepgram' NOT NULL;
--> statement-breakpoint
ALTER TABLE "transcripts" ADD COLUMN "provider_request_id" text;
--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_media_object_id_media_objects_id_fk" FOREIGN KEY ("media_object_id") REFERENCES "public"."media_objects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "speaker_assignments" ADD CONSTRAINT "speaker_assignments_media_object_id_media_objects_id_fk" FOREIGN KEY ("media_object_id") REFERENCES "public"."media_objects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "speaker_assignments" ADD CONSTRAINT "speaker_assignments_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "summary_embeddings" ADD CONSTRAINT "summary_embeddings_media_object_id_media_objects_id_fk" FOREIGN KEY ("media_object_id") REFERENCES "public"."media_objects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "transcript_chunks" ADD CONSTRAINT "transcript_chunks_media_object_id_media_objects_id_fk" FOREIGN KEY ("media_object_id") REFERENCES "public"."media_objects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "dictionary_terms_owner_idx" ON "dictionary_terms" USING btree ("owner_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "dictionary_terms_owner_term_idx" ON "dictionary_terms" USING btree ("owner_id","term");
--> statement-breakpoint
CREATE UNIQUE INDEX "notes_media_object_idx" ON "notes" USING btree ("media_object_id");
--> statement-breakpoint
CREATE INDEX "notes_owner_idx" ON "notes" USING btree ("owner_id");
--> statement-breakpoint
CREATE INDEX "people_owner_idx" ON "people" USING btree ("owner_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "speaker_assignments_media_speaker_idx" ON "speaker_assignments" USING btree ("media_object_id","speaker_idx");
--> statement-breakpoint
CREATE INDEX "transcript_chunks_media_idx" ON "transcript_chunks" USING btree ("media_object_id");
