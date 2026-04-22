CREATE TYPE "public"."media_object_status" AS ENUM('uploading', 'transcribing', 'processing', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."media_object_type" AS ENUM('video', 'audio');--> statement-breakpoint
CREATE TABLE "ai_outputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"media_object_id" uuid NOT NULL,
	"title_suggested" text,
	"summary" text,
	"chapters" jsonb,
	"action_items" jsonb,
	"llm_model" text NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brand_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"accent_color" text NOT NULL,
	"logo_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"media_object_id" uuid NOT NULL,
	"commenter_name" text NOT NULL,
	"commenter_email" text NOT NULL,
	"timestamp_sec" numeric NOT NULL,
	"body" text NOT NULL,
	"read_by_creator_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_objects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"type" "media_object_type" NOT NULL,
	"slug" text NOT NULL,
	"title" text,
	"description" text,
	"status" "media_object_status" NOT NULL,
	"brand_profile_id" uuid,
	"duration_seconds" numeric,
	"r2_composite_key" text,
	"r2_screen_key" text,
	"r2_camera_key" text,
	"r2_mic_key" text,
	"r2_systemaudio_key" text,
	"composite_thumbnail_key" text,
	"trim_start_sec" numeric,
	"trim_end_sec" numeric,
	"password_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "media_objects_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "transcripts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"media_object_id" uuid NOT NULL,
	"deepgram_request_id" text,
	"language" text DEFAULT 'en',
	"full_text" text NOT NULL,
	"word_timestamps" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"media_object_id" uuid NOT NULL,
	"viewer_ip_hash" text NOT NULL,
	"viewer_country" text,
	"watched_seconds" numeric DEFAULT '0',
	"max_watched_sec" numeric DEFAULT '0',
	"user_agent_summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_outputs" ADD CONSTRAINT "ai_outputs_media_object_id_media_objects_id_fk" FOREIGN KEY ("media_object_id") REFERENCES "public"."media_objects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_media_object_id_media_objects_id_fk" FOREIGN KEY ("media_object_id") REFERENCES "public"."media_objects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_objects" ADD CONSTRAINT "media_objects_brand_profile_id_brand_profiles_id_fk" FOREIGN KEY ("brand_profile_id") REFERENCES "public"."brand_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcripts" ADD CONSTRAINT "transcripts_media_object_id_media_objects_id_fk" FOREIGN KEY ("media_object_id") REFERENCES "public"."media_objects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "views" ADD CONSTRAINT "views_media_object_id_media_objects_id_fk" FOREIGN KEY ("media_object_id") REFERENCES "public"."media_objects"("id") ON DELETE cascade ON UPDATE no action;