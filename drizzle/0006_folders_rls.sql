--> Stage 1.x security fix — `folders` was missing RLS + auth FK.
--> Added in migration 0004 (Stage 1.5b) without the same hardening that
--> brand_profiles / media_objects got in migration 0001. Supabase's
--> security advisor flagged it as `rls_disabled_in_public`.
-->
--> Like the other tables, the app's Drizzle queries connect via the
--> `postgres` role and BYPASS RLS — ownership is enforced in server
--> action / API code. These policies are defense-in-depth against any
--> future code path that hits the table via the anon JWT.

-->
--> statement-breakpoint
ALTER TABLE "folders"
  ADD CONSTRAINT "folders_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES auth.users("id")
  ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "folders" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "folders_owner_all" ON "folders"
  FOR ALL
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);
