--> Stage 1.x security fix — `folders` was missing RLS.
--> Stage 1.5b added the table in migration 0004 without the RLS hardening
--> the other six tables got in migration 0001. Supabase's security
--> advisor flagged it as `rls_disabled_in_public`.
-->
--> The app's Drizzle queries connect via the `postgres` role and BYPASS
--> RLS — ownership is enforced in server action / API code. RLS here is
--> defense-in-depth against any future code path that hits the table
--> via the anon JWT.
-->
--> NOTE: an earlier draft of this migration also added a FK from
--> folders.owner_id to auth.users(id). That ALTER blew up at boot
--> because the constraint can't be added if even one folder row has an
--> orphaned owner_id, and crashed the container. Auth-FK consistency
--> with brand_profiles + media_objects is nice but not essential — the
--> ON DELETE behaviour is already handled in app code. Dropping it.
-->
--> All statements below are idempotent so this is safe to re-run if a
--> previous attempt left partial state.

--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'folders' AND c.relrowsecurity = true
  ) THEN
    EXECUTE 'ALTER TABLE "folders" ENABLE ROW LEVEL SECURITY';
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'folders' AND policyname = 'folders_owner_all'
  ) THEN
    EXECUTE $POLICY$
      CREATE POLICY "folders_owner_all" ON "folders"
        FOR ALL
        USING (auth.uid() = owner_id)
        WITH CHECK (auth.uid() = owner_id)
    $POLICY$;
  END IF;
END $$;
