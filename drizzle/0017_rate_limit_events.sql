CREATE TABLE IF NOT EXISTS "rate_limit_events" (
  "id" bigserial PRIMARY KEY,
  "scope" text NOT NULL,
  "key" text NOT NULL,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rate_limit_events_scope_key_occurred_at_idx"
  ON "rate_limit_events" USING btree ("scope", "key", "occurred_at" DESC);
--> statement-breakpoint
ALTER TABLE "rate_limit_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Service-role-only: rate-limit accounting is a server-side concern. No
-- "authenticated" or "anon" role gets read or write access through PostgREST;
-- the Next.js API talks to Postgres with the service-role connection string,
-- which bypasses RLS by design.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'rate_limit_events'
      AND policyname = 'rate_limit_events_no_role_access'
  ) THEN
    CREATE POLICY "rate_limit_events_no_role_access" ON "rate_limit_events"
      AS PERMISSIVE FOR ALL TO authenticated, anon
      USING (false)
      WITH CHECK (false);
  END IF;
END $$;
