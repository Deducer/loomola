ALTER TABLE "user_preferences" ADD COLUMN "role" text NOT NULL DEFAULT 'member';
--> statement-breakpoint
-- Existing instances are single-user: every current user becomes admin.
INSERT INTO "user_preferences" ("owner_id", "role")
SELECT u.id, 'admin' FROM auth.users u
ON CONFLICT ("owner_id") DO UPDATE SET "role" = 'admin';
--> statement-breakpoint
CREATE TABLE "invites" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "created_by" uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  "email" text NOT NULL,
  "token_hash" text NOT NULL UNIQUE,
  "expires_at" timestamptz NOT NULL,
  "accepted_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invites" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'invites'
      AND policyname = 'invites_owner_all'
  ) THEN
    EXECUTE $POLICY$
      CREATE POLICY "invites_owner_all" ON "invites"
        AS PERMISSIVE FOR ALL TO authenticated
        USING (auth.uid() = created_by)
        WITH CHECK (auth.uid() = created_by)
    $POLICY$;
  END IF;
END $$;
