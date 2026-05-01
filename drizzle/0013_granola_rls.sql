--> Enables RLS on all six Granola-alt tables and creates owner-scoped
--> policies matching the existing defense-in-depth pattern.
-->
--> Also creates HNSW vector indices for future semantic search.

--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'public' AND c.relname = 'notes' AND c.relrowsecurity = true) THEN
    EXECUTE 'ALTER TABLE "notes" ENABLE ROW LEVEL SECURITY';
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notes' AND policyname = 'notes_owner_all') THEN
    EXECUTE $POLICY$
      CREATE POLICY "notes_owner_all" ON "notes"
        AS PERMISSIVE FOR ALL TO authenticated
        USING (owner_id = auth.uid())
        WITH CHECK (owner_id = auth.uid())
    $POLICY$;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'public' AND c.relname = 'people' AND c.relrowsecurity = true) THEN
    EXECUTE 'ALTER TABLE "people" ENABLE ROW LEVEL SECURITY';
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'people' AND policyname = 'people_owner_all') THEN
    EXECUTE $POLICY$
      CREATE POLICY "people_owner_all" ON "people"
        AS PERMISSIVE FOR ALL TO authenticated
        USING (owner_id = auth.uid())
        WITH CHECK (owner_id = auth.uid())
    $POLICY$;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'public' AND c.relname = 'dictionary_terms' AND c.relrowsecurity = true) THEN
    EXECUTE 'ALTER TABLE "dictionary_terms" ENABLE ROW LEVEL SECURITY';
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'dictionary_terms' AND policyname = 'dictionary_terms_owner_all') THEN
    EXECUTE $POLICY$
      CREATE POLICY "dictionary_terms_owner_all" ON "dictionary_terms"
        AS PERMISSIVE FOR ALL TO authenticated
        USING (owner_id = auth.uid())
        WITH CHECK (owner_id = auth.uid())
    $POLICY$;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'public' AND c.relname = 'speaker_assignments' AND c.relrowsecurity = true) THEN
    EXECUTE 'ALTER TABLE "speaker_assignments" ENABLE ROW LEVEL SECURITY';
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'speaker_assignments' AND policyname = 'speaker_assignments_owner_via_media') THEN
    EXECUTE $POLICY$
      CREATE POLICY "speaker_assignments_owner_via_media" ON "speaker_assignments"
        AS PERMISSIVE FOR ALL TO authenticated
        USING (EXISTS (SELECT 1 FROM media_objects m WHERE m.id = media_object_id AND m.owner_id = auth.uid()))
        WITH CHECK (EXISTS (SELECT 1 FROM media_objects m WHERE m.id = media_object_id AND m.owner_id = auth.uid()))
    $POLICY$;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'public' AND c.relname = 'transcript_chunks' AND c.relrowsecurity = true) THEN
    EXECUTE 'ALTER TABLE "transcript_chunks" ENABLE ROW LEVEL SECURITY';
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'transcript_chunks' AND policyname = 'transcript_chunks_owner_via_media') THEN
    EXECUTE $POLICY$
      CREATE POLICY "transcript_chunks_owner_via_media" ON "transcript_chunks"
        AS PERMISSIVE FOR ALL TO authenticated
        USING (EXISTS (SELECT 1 FROM media_objects m WHERE m.id = media_object_id AND m.owner_id = auth.uid()))
        WITH CHECK (EXISTS (SELECT 1 FROM media_objects m WHERE m.id = media_object_id AND m.owner_id = auth.uid()))
    $POLICY$;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = 'public' AND c.relname = 'summary_embeddings' AND c.relrowsecurity = true) THEN
    EXECUTE 'ALTER TABLE "summary_embeddings" ENABLE ROW LEVEL SECURITY';
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'summary_embeddings' AND policyname = 'summary_embeddings_owner_via_media') THEN
    EXECUTE $POLICY$
      CREATE POLICY "summary_embeddings_owner_via_media" ON "summary_embeddings"
        AS PERMISSIVE FOR ALL TO authenticated
        USING (EXISTS (SELECT 1 FROM media_objects m WHERE m.id = media_object_id AND m.owner_id = auth.uid()))
        WITH CHECK (EXISTS (SELECT 1 FROM media_objects m WHERE m.id = media_object_id AND m.owner_id = auth.uid()))
    $POLICY$;
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS transcript_chunks_embedding_idx
  ON transcript_chunks USING hnsw (embedding vector_cosine_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS summary_embeddings_embedding_idx
  ON summary_embeddings USING hnsw (embedding vector_cosine_ops);
