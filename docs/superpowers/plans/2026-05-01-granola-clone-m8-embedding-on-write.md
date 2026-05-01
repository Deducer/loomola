# Granola-alt M8 — Embedding on Write

Date: 2026-05-01
Status: shipped

## Goal

Start accumulating semantic-search-ready vectors as soon as transcripts and generated summaries exist. No retrieval UI ships in this milestone.

## Scope

- [x] Add a small OpenAI embedding adapter using `OPENAI_API_KEY`.
- [x] Chunk transcripts into roughly 512-token windows with timestamp bounds.
- [x] Write `transcript_chunks` rows idempotently after Deepgram transcription.
- [x] Add an `embed_summary` job that upserts `summary_embeddings` after title/summary generation.
- [x] Keep embedding jobs best-effort: failures retry and log, but do not mark meetings failed.
- [x] Update the design spec with image attachment / visual context behavior for later notes polish.
- [x] Run typecheck, focused unit tests, and a production smoke on the latest uploaded note.

## Notes

- `ENABLE_GRANOLA=false` remains Loom-only. Embedding queues only run when Granola is enabled.
- The first adapter is direct OpenAI `text-embedding-3-small` at 1536 dimensions, matching the existing pgvector schema.
- `embed_summary` is useful now for Loom video summaries when Granola is enabled, and becomes the natural follow-on job for the G-M9 user-triggered Generate Notes flow.
