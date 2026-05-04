CREATE TABLE IF NOT EXISTS "note_attachments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "media_object_id" uuid NOT NULL REFERENCES "media_objects"("id") ON DELETE cascade,
  "owner_id" uuid NOT NULL,
  "kind" text DEFAULT 'image' NOT NULL,
  "r2_key" text NOT NULL,
  "filename" text NOT NULL,
  "content_type" text NOT NULL,
  "byte_size" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "note_attachments_media_object_idx"
  ON "note_attachments" USING btree ("media_object_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "note_attachments_owner_idx"
  ON "note_attachments" USING btree ("owner_id");
--> statement-breakpoint
ALTER TABLE "note_attachments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'note_attachments'
      AND policyname = 'note_attachments_owner_all'
  ) THEN
    CREATE POLICY "note_attachments_owner_all" ON "note_attachments"
      AS PERMISSIVE FOR ALL TO authenticated
      USING ("owner_id" = auth.uid())
      WITH CHECK ("owner_id" = auth.uid());
  END IF;
END $$;
