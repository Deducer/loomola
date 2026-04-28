# Recording Quality Audit — 2026-04-28

## Current Recording Path

- The web recorder captures screen, camera, mic, and optional Chrome system audio.
- A hidden canvas composites screen + camera bubble at 30fps.
- Five MediaRecorders can run in parallel: composite, raw screen, raw camera, raw mic, raw system audio.
- Chunks upload every 5 seconds through the existing multipart R2 flow.
- The dashboard/player currently serve one composite object directly from R2.

## Improvements Shipped In This Pass

- Dashboard bulk selection feels less browser-native:
  - Escape clears selection.
  - Shift-click selects a range.
  - Bulk delete is a two-step inline confirmation instead of a blocking browser confirm.
  - Move/delete failures and successes use Sonner toasts.
- Recorder output is less dependent on Chrome defaults:
  - MediaRecorder now falls back through supported WebM/Opus MIME types.
  - Composite/screen/camera tracks now request explicit resolution-aware video bitrates.
  - Audio tracks now request a 128kbps Opus bitrate.
- Playback now has a browser-friendly MP4 path:
  - New uploads enqueue a `transcode_playback` background job after the composite upload completes.
  - The job keeps the original WebM, creates a fast-start H.264/AAC MP4 copy with ffmpeg, uploads it to R2, and stores the key on `media_objects.playback_mp4_key`.
  - Share and edit pages prefer the MP4 when available, then fall back to the original composite while the job is still pending or for older recordings.

## Quality Risks Found

1. **Existing recordings do not have MP4 playback copies yet.**
   New uploads will generate MP4 assets automatically, but older recordings need a small backfill job if we want the whole library to benefit.

2. **No adaptive playback yet.**
   The dashboard/player serve one full-size composite file. This is simple and works, but mobile/cellular viewers download the same large bitrate as desktop viewers.

3. **Hover previews currently use the full video.**
   It works and feels good, but it is heavier than Loom. Generate a short low-bitrate preview MP4/WebM or reuse the preview sprite pipeline for cheaper hover previews.

4. **Audio sync needs a test matrix.**
   The mic + system-audio mix is sensible, but real machines can drift under CPU load. Test Chrome recordings at 1080p, 1440p, and 4k with mic-only, system-only, and mixed audio.

5. **4k may overwork browser recording.**
   Explicit bitrate helps quality, but 4k canvas compositing + VP9 encoding can be CPU-heavy. Native desktop recording is still the best long-term quality path.

## Recommended Next Builds

1. Run a backfill for existing recordings that have `r2_composite_key` but no `playback_mp4_key`.
2. Add optional HLS output (`.m3u8` + segments) for adaptive playback once MP4 is stable in production.
3. Generate short hover-preview files instead of loading the full composite on dashboard hover.
4. Add recording diagnostics to saved metadata: chosen MIME type, requested bitrate, actual dimensions, track count, and browser.
5. Run a manual QA matrix on an M4 Pro Mac: 1080p/1440p/4k, with and without camera, with and without system audio, 30-second and 5-minute recordings.
