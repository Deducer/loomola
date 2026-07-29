# Calendar reminder reliability

**Status:** Implemented and installed on 2026-07-27. Live scheduling, Settings diagnostics, Launch at Login, and the Today picker were verified against the user's real calendar; notification delivery/actions and positive native Zoom detection remain to be observed during the next eligible event/call.

## Problem

Loomola's meeting prompt currently depends on a recent Chrome-extension signal during idle use. Native Zoom windows are only inspected when capture sources are explicitly refreshed, so opening or joining Zoom after Loomola launches produces no prompt. Calendar access is used only after an audio note starts, and the Today picker hides events that have no recognized non-self attendees. There is no scheduled pre-meeting notification or Launch at Login control.

## Intended behavior

- A timed calendar event with a recognized conferencing link remains linkable even when it has no attendees; non-meeting routine blocks stay out of the picker.
- A calendar event containing a recognized Zoom, Meet, Teams, Webex, or FaceTime join link schedules a local notification one minute before its start. Loomola never creates a late notification after the event starts.
- Notification actions can open the join link or start an audio note using the calendar title.
- While Loomola is running, native Zoom/Teams/Webex/FaceTime windows are checked with the lightweight Core Graphics window list, alongside the Chrome bridge. This avoids continuous ScreenCaptureKit enumeration.
- Settings expose calendar reminders, macOS notification status, the next scheduled reminder, and Launch at Login.
- Calendar provenance is saved on an audio note even when the event has zero attendees.

## Guardrails

- No meeting is auto-recorded. Starting notes always requires a user action.
- All-day, canceled, declined, already-started, and linkless events do not schedule reminders.
- Only Loomola-owned pending notification identifiers are reconciled.
- Existing calendar data is read-only; only local notification requests and local app preferences are written.
- The currently running app is not replaced or relaunched during an active recording or meeting.

## Verification

- Unit-test event selection, attendee-less provenance, reminder eligibility/timing, deduplication, and native-window matching.
- Run the full desktop Swift test suite and build the app bundle from the repository.
- After the meeting ends: install/relaunch, schedule a near-future calendar event, verify the macOS banner and actions, and verify native Zoom detection plus the Today picker against a real note.
