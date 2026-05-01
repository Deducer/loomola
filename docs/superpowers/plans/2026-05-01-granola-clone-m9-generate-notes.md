# Granola-alt M9 — Generate Notes

Date: 2026-05-01
Status: shipped

## Goal

Add the first user-visible AI enhancement loop for audio notes: raw notes plus transcript become polished markdown notes on demand.

## Scope

- [x] Add `POST /api/notes/:id/enhance` to reset/create `ai_outputs` and enqueue enhancement jobs.
- [x] Add `GET /api/notes/:id/enhance` so the notes page can poll generation status.
- [x] Adapt the title/summary job for audio notes so it uses the notes-first Granola prompt instead of the Loom video prompt.
- [x] Render a Generate notes button when a note has a transcript but no enhanced output.
- [x] Render pending/failed/complete states and an Original / Enhanced toggle.
- [x] Run typecheck, build, focused tests, and a production smoke.

## Notes

- The first implementation uses polling rather than Supabase Realtime streaming. Realtime remains in the spec for the polished streaming pill follow-up.
- `ai_outputs.summary` stores the enhanced markdown body. `notes.body` remains the user's original notes.
