-- Resume after Stop (desktop): a saved audio note can record further
-- segments. Each one's raw mic/system tracks are appended here in order;
-- segment 1 keeps living in r2_mic_key / r2_systemaudio_key. mix_audio
-- concatenates all segments' tracks before ducking, mixing and loudnorm,
-- so the batch transcript covers the whole note.
ALTER TABLE "media_objects" ADD COLUMN "audio_segments" jsonb;
