-- Speaker recognition v2, Phase 1 (spec: docs/superpowers/specs/
-- 2026-10-27-speaker-recognition-v2-granola-parity-design.md).
--
-- transcripts.speaker_profile: per-diarized-voice capture evidence
--   (mic vs system audio share), recomputed whenever the transcript is
--   replaced, so "Me" comes from the mic track instead of talk time.
-- media_objects.r2_activity_key: 100 ms mic/system loudness frames
--   (activity.bin) written by mix_audio, so profiles never re-decode audio.
-- speaker_assignments.transcript_version: "<provider>:<created_at>" of the
--   transcript a row was computed or confirmed against. Rows on an older
--   version are reconciled instead of silently mislabeling re-indexed
--   voices (the live -> batch replacement bug).
-- speaker_assignments.needs_review: a user decision that could not be
--   carried onto the new transcript with capture evidence.
-- speaker_assignments.auto_applied: written without a click from capture
--   evidence (mic track, sole remote voice on a 1:1); undoable.
--
-- Additive and idempotent.

ALTER TABLE "transcripts" ADD COLUMN IF NOT EXISTS "speaker_profile" jsonb;
--> statement-breakpoint
ALTER TABLE "media_objects" ADD COLUMN IF NOT EXISTS "r2_activity_key" text;
--> statement-breakpoint
ALTER TABLE "speaker_assignments" ADD COLUMN IF NOT EXISTS "transcript_version" text;
--> statement-breakpoint
ALTER TABLE "speaker_assignments" ADD COLUMN IF NOT EXISTS "needs_review" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "speaker_assignments" ADD COLUMN IF NOT EXISTS "auto_applied" boolean DEFAULT false NOT NULL;
