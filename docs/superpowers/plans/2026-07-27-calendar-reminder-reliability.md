# Calendar reminder reliability implementation plan

1. Separate calendar-event matching from attendee extraction; map event identifiers, join links, cancellation, and current-user decline state.
2. Add a pure reminder planner and an EventKit/UserNotifications coordinator that reconciles the next 24 hours and refreshes when calendars change.
3. Route notification actions through AppDelegate and RecorderCommands to the SwiftUI-owned recorder view model.
4. Add a low-cost Core Graphics native meeting-window fallback to the existing idle watch and tighten browser Meet matching.
5. Add Calendar reminders and Launch at Login controls plus diagnostic status to Settings.
6. Add focused tests, run the full Swift suite, and build without touching the installed/running app.
7. Once the active meeting is over, install the build and verify a real near-future event and active Zoom window end to end.
