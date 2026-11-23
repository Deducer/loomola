# Meeting screenshots — plan

Spec: [`../specs/2026-11-22-meeting-screenshots-design.md`](../specs/2026-11-22-meeting-screenshots-design.md)

Server first, because it is backward compatible with installed desktop builds.

## Server

1. Migration `0036_note_screenshots.sql`: `offset_ms`, `description` on
   `note_attachments`; schema + journal.
2. `src/lib/notes/screenshots.ts`: constants, form-field parsing, offset
   formatting, "said around then" lookup from word timestamps, prompt lines.
3. `src/lib/notes/describe-screenshot.ts`: one model call per frame;
   `described` / `no_shared_content` / `unavailable`.
4. `POST`/`GET /api/notes/:id/attachments`: screenshot fields, cap, drop
   no-shared-content frames before storing.
5. `generate-title-summary`: describe any screenshot still missing a
   description, add the screenshot section to the notes prompt, send only
   hand-attached images as images.
6. Web note page: a "Meeting screenshots" row, separate from attached images.
7. MCP `loomola_get_media`: `include: ["screenshots"]`.
8. Unit tests: helpers, prompt, route.

## Desktop

1. `MeetingWindowMatcher` (pure): is this window a call?
2. `ScreenshotChangeDetector` (pure): changed-and-settled, spacing, cap.
3. `MeetingScreenshotCapturer`: 6 s loop, ScreenCaptureKit single-frame
   capture of the matched window, JPEG, hand-off to an upload closure.
4. `BackendClient.uploadNoteScreenshot`; DTO gains optional `kind`,
   `offsetMs`, `description`.
5. `RecorderViewModel`: setting, start after the note starts, stop on
   stop/discard/failure, offsets in recorded-audio time.
6. Settings toggle; workspace "Meeting screenshots" strip.
7. `--meeting-screenshot-selftest <dir> [seconds]` launch argument: runs the
   real capturer against the windows on screen and writes frames plus a JSON
   report to `<dir>` instead of uploading. Lets the capture path be checked
   under the installed app's own Screen Recording grant without starting a
   recording.
8. Swift tests for the two pure types and the multipart body.

## Verify

- `npm test`, `npm run typecheck`, `npm run lint`; `swift build`, `swift test`.
- After the web deploy: upload a screenshot to a throwaway audio note with the
  desktop token, read it back, delete the note.
- After the desktop install: self-test against a window titled like a Meet
  call whose content changes on a timer.
