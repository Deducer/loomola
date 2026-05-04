ALTER TABLE "speaker_assignments"
  ADD COLUMN "is_suggestion" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "speaker_assignments"
  ADD COLUMN "suggested_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "speaker_assignments"
  ADD COLUMN "dismissed_at" timestamp with time zone;
--> statement-breakpoint
-- When a suggestion proposes creating a new Person from meeting attendee
-- data, the proposed payload is stored here so the UI can pre-fill the
-- create-Person form on accept. NULL when the suggestion is already
-- bound to an existing person_id.
ALTER TABLE "speaker_assignments"
  ADD COLUMN "suggested_new_person_payload" jsonb;
--> statement-breakpoint
ALTER TABLE "people"
  ADD COLUMN "is_self" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
-- At most one self-Person per owner. Partial unique index so we don't
-- conflict with the many is_self=false rows.
CREATE UNIQUE INDEX IF NOT EXISTS "people_owner_self_unique"
  ON "people" ("owner_id")
  WHERE "is_self" = true;
