CREATE TABLE IF NOT EXISTS "user_preferences" (
  "owner_id" uuid PRIMARY KEY,
  "transcription_language" text NOT NULL DEFAULT 'en',
  "summary_language" text NOT NULL DEFAULT 'same-as-transcript',
  "transcript_retention_days" integer,
  "meeting_detection_enabled" boolean NOT NULL DEFAULT true,
  "floating_recording_indicator_enabled" boolean NOT NULL DEFAULT true,
  "notify_first_view" boolean NOT NULL DEFAULT true,
  "notify_comments" boolean NOT NULL DEFAULT true,
  "notify_marketing" boolean NOT NULL DEFAULT false,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "user_preferences_transcription_language_check"
    CHECK ("transcription_language" IN ('auto', 'en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'hi', 'ja', 'ko', 'zh')),
  CONSTRAINT "user_preferences_summary_language_check"
    CHECK ("summary_language" IN ('same-as-transcript', 'en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'hi', 'ja', 'ko', 'zh')),
  CONSTRAINT "user_preferences_retention_check"
    CHECK ("transcript_retention_days" IS NULL OR "transcript_retention_days" IN (30, 90, 365))
);
--> statement-breakpoint
ALTER TABLE "user_preferences" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'user_preferences'
      AND policyname = 'user_preferences_owner_all'
  ) THEN
    EXECUTE $POLICY$
      CREATE POLICY "user_preferences_owner_all" ON "user_preferences"
        AS PERMISSIVE FOR ALL TO authenticated
        USING (owner_id = auth.uid())
        WITH CHECK (owner_id = auth.uid())
    $POLICY$;
  END IF;
END $$;
