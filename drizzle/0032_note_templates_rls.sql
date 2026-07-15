ALTER TABLE "note_templates" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "note_templates_owner_all" ON "note_templates"
  AS PERMISSIVE FOR ALL TO authenticated
  USING ("owner_id" = auth.uid())
  WITH CHECK ("owner_id" = auth.uid());
