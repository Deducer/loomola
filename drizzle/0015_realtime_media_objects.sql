--> Adds media_objects to the Supabase Realtime publication so the
--> desktop app can wake its Obsidian writer as soon as a note is queued.
-->
--> Idempotent: duplicate publication membership is ignored.

--> statement-breakpoint
DO $$ BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE media_objects;
  EXCEPTION
    WHEN duplicate_object THEN
      NULL;
  END;
END $$;
