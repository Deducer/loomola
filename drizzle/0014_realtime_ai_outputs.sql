--> Adds ai_outputs to the Supabase Realtime publication for future
--> streaming AI enhancement updates on /notes/:id.
-->
--> Idempotent: duplicate publication membership is ignored.

--> statement-breakpoint
DO $$ BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE ai_outputs;
  EXCEPTION
    WHEN duplicate_object THEN
      NULL;
  END;
END $$;
