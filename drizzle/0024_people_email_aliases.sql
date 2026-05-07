-- Multi-email support on people. Spec context:
--   docs/superpowers/specs/2026-05-06-granola-migration-tool-design.md
--   user-feedback (post-migration dogfood, 2026-05-07)
--
-- Bhaskar/Harsha/Neely each turned out to have multiple emails across
-- Granola attendances; my migration created N rows per person. To
-- preserve the structured "people" canonicalization (so analytics like
-- "who have I been meeting with most" group correctly), people now carry
-- an `email_aliases` jsonb array of additional emails. The primary
-- `email` field remains the canonical one. The merge endpoint moves
-- merged rows' emails into this array.

ALTER TABLE "people"
  ADD COLUMN "email_aliases" jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
-- Lookup index: GIN on the array so `email_aliases @> '["foo@bar"]'`
-- queries (used by findPersonByAnyEmail) hit an index.
CREATE INDEX IF NOT EXISTS "people_email_aliases_gin"
  ON "people" USING gin ("email_aliases");
