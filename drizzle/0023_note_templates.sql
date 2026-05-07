ALTER TABLE "notes"
  ADD COLUMN "template_id" text NOT NULL DEFAULT 'general-meeting';

ALTER TABLE "ai_outputs"
  ALTER COLUMN "template_id" SET DEFAULT 'general-meeting';

UPDATE "ai_outputs"
SET "template_id" = 'general-meeting'
WHERE "template_id" = 'default';

CREATE INDEX "notes_owner_template_idx"
  ON "notes" ("owner_id", "template_id");
