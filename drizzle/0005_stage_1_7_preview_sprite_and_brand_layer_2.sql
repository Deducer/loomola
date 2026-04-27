--> Stage 1.7 — preview-thumbnail sprite + brand profile Layer 2 fields.
--> statement-breakpoint
ALTER TABLE "media_objects" ADD COLUMN "preview_sprite_key" text;
--> statement-breakpoint
ALTER TABLE "brand_profiles" ADD COLUMN "tagline" text;
--> statement-breakpoint
ALTER TABLE "brand_profiles" ADD COLUMN "font_family" text;
--> statement-breakpoint
ALTER TABLE "brand_profiles" ADD COLUMN "cta_label" text;
--> statement-breakpoint
ALTER TABLE "brand_profiles" ADD COLUMN "cta_url" text;
--> statement-breakpoint
ALTER TABLE "brand_profiles" ADD COLUMN "footer_text" text;
