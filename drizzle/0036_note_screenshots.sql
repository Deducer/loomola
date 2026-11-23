-- Meeting screenshots: the desktop app saves a picture of the meeting window
-- when the shared screen changes. Those rows use kind = 'screenshot' and carry
-- when they were taken (recorded-audio time) plus a short model-written
-- description that the notes prompt uses in place of the image.
ALTER TABLE "note_attachments" ADD COLUMN IF NOT EXISTS "offset_ms" integer;
--> statement-breakpoint
ALTER TABLE "note_attachments" ADD COLUMN IF NOT EXISTS "description" text;
