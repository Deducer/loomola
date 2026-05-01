ALTER TABLE "brand_profiles"
  ADD COLUMN IF NOT EXISTS "default_theme" text;

ALTER TABLE "brand_profiles"
  DROP CONSTRAINT IF EXISTS "brand_profiles_default_theme_check";

ALTER TABLE "brand_profiles"
  ADD CONSTRAINT "brand_profiles_default_theme_check"
    CHECK ("default_theme" IS NULL OR "default_theme" IN ('light', 'dark'));
