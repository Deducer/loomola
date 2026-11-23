# Meeting screenshots (automatic shared-screen capture)

**Date:** 2026-11-22. **Status:** approved by Ian in session, built the same day.

## Problem

Audio meeting notes keep the transcript and lose the screen. On calls with a
deck, a product demo or a design review, "this slide" and "this screen here"
mean nothing afterwards. Images can be attached by hand, but nobody does that
mid-call.

## What it does

While an audio note is recording, the desktop app saves a picture of the
meeting window each time the shared screen changes. Each picture gets a time
offset and a short text description, and the AI notes use those descriptions.

## Decisions

- **Meeting window only.** Capture the window that meeting detection
  recognises (Zoom, Teams, Webex, FaceTime, or a browser window whose active
  tab is a Meet/Teams/Zoom call). Never the display. No meeting window, no
  capture. A browser window is only captured while the call tab is the active
  tab, because the window title is what identifies it.
- **Keep only changes that have settled.** Sample every 6 seconds. Keep a frame
  only when it differs from the last kept frame *and* matches the sample
  before it. A slide that has just appeared is kept; a gallery of moving faces
  or a scrolling demo is not, until it holds still. At most one kept frame per
  12 seconds and 40 per recording.
- **Describe once, at upload.** The server asks the cheap model
  (`getClassifierLlm`) for a one or two sentence description before storing
  the frame. If the model says the frame shows no shared content (participant
  tiles only), the frame is dropped and never stored. If the model is
  unavailable the frame is stored without a description and the summary job
  fills it in later.
- **Text to the summary, not images.** The notes prompt gets one line per
  screenshot: time, description, and the words spoken in the following few
  seconds so the model can place it in the transcript. Hand-attached images
  still go to the model as images (first six), as before.
- **Private.** Screenshots live in `note_attachments`, which only the owner's
  note page, the desktop workspace and the owner's MCP token can read. Shared
  pages never showed attachments and still don't.
- **Off by default.** `loomola.meetingScreenshotsEnabled` in desktop Settings.
  Uses the Screen Recording permission the app already asks for.

## Data

`note_attachments` gains `offset_ms integer` and `description text`. A
screenshot row has `kind = 'screenshot'`; hand-attached images keep
`kind = 'image'`, so the notes-list thumbnails (which filter on `image`)
ignore screenshots without a change.

`offset_ms` is recorded-audio time: paused time is excluded, and a resumed
segment starts from the saved note's duration, so offsets line up with
transcript word times.

## API

`POST /api/notes/:id/attachments` accepts two optional form fields,
`kind=screenshot` and `offsetMs`. For a screenshot it returns
`{ attachment }` (201) or `{ attachment: null, skipped: "no_shared_content" }`
(200), and `409 screenshot_limit` past 60 per note. `GET` returns `kind`,
`offsetMs` and `description` on every attachment. Old desktop builds send
neither field and behave as before.

MCP `loomola_get_media` takes `include: ["screenshots"]`.

## Not in this version

- Detecting screen share directly (no API for it; "changed and settled" plus
  the model's no-shared-content verdict stand in).
- Showing screenshots on shared pages.
- Clicking a screenshot to seek the audio.
