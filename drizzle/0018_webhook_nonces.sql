CREATE TABLE IF NOT EXISTS "webhook_nonces" (
  "nonce" text PRIMARY KEY,
  "recording_id" uuid NOT NULL REFERENCES "media_objects"("id") ON DELETE cascade,
  "provider" text NOT NULL,
  "issued_at" timestamp with time zone DEFAULT now() NOT NULL,
  "consumed_at" timestamp with time zone,
  "expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_nonces_recording_id_idx"
  ON "webhook_nonces" USING btree ("recording_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_nonces_expires_at_idx"
  ON "webhook_nonces" USING btree ("expires_at");
--> statement-breakpoint
ALTER TABLE "webhook_nonces" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Service-role-only: nonces are a server-side concern. PostgREST roles
-- (authenticated, anon) get no access. The Next.js webhook route reaches
-- the table through the service-role connection string.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'webhook_nonces'
      AND policyname = 'webhook_nonces_no_role_access'
  ) THEN
    CREATE POLICY "webhook_nonces_no_role_access" ON "webhook_nonces"
      AS PERMISSIVE FOR ALL TO authenticated, anon
      USING (false)
      WITH CHECK (false);
  END IF;
END $$;
