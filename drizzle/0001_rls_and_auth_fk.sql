-- ---------------------------------------------------------------------------
-- Foreign keys to auth.users (Supabase-managed table)
-- ---------------------------------------------------------------------------

ALTER TABLE "brand_profiles"
  ADD CONSTRAINT "brand_profiles_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES auth.users("id")
  ON DELETE CASCADE;

ALTER TABLE "media_objects"
  ADD CONSTRAINT "media_objects_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES auth.users("id")
  ON DELETE CASCADE;

-- ---------------------------------------------------------------------------
-- Row-Level Security — defense-in-depth
--
-- The app uses Drizzle via the postgres pooler, which connects as the
-- `postgres` role and BYPASSES RLS. Ownership is enforced in server action
-- code. These policies are insurance against any future code path that
-- queries via the anon JWT (e.g. direct Supabase client usage).
-- ---------------------------------------------------------------------------

ALTER TABLE "brand_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "media_objects" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "transcripts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_outputs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "views" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "comments" ENABLE ROW LEVEL SECURITY;

-- Owner-scoped full access on the owned tables
CREATE POLICY "brand_profiles_owner_all" ON "brand_profiles"
  FOR ALL
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "media_objects_owner_all" ON "media_objects"
  FOR ALL
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

-- Join-scoped access on child tables (only if you own the parent media_object)
CREATE POLICY "transcripts_owner_select" ON "transcripts"
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM media_objects
    WHERE media_objects.id = transcripts.media_object_id
      AND media_objects.owner_id = auth.uid()
  ));

CREATE POLICY "ai_outputs_owner_select" ON "ai_outputs"
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM media_objects
    WHERE media_objects.id = ai_outputs.media_object_id
      AND media_objects.owner_id = auth.uid()
  ));

CREATE POLICY "views_owner_select" ON "views"
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM media_objects
    WHERE media_objects.id = views.media_object_id
      AND media_objects.owner_id = auth.uid()
  ));

CREATE POLICY "comments_owner_select" ON "comments"
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM media_objects
    WHERE media_objects.id = comments.media_object_id
      AND media_objects.owner_id = auth.uid()
  ));

-- Public INSERT policies for views + comments will be added in later
-- milestones (M8: view tracking, M9: comments). For now, all writes to
-- these tables require being the owner.
