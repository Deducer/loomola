import XCTest
@testable import LoomDesktopApp

final class CalendarMeetingReminderPlannerTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)

    private func event(
        identifier: String = "event-1",
        title: String = "Weekly planning",
        startOffset: TimeInterval = 10 * 60,
        isAllDay: Bool = false,
        joinURL: URL? = URL(string: "https://zoom.us/j/123456789"),
        isCanceled: Bool = false,
        isDeclined: Bool = false
    ) -> CalendarEventCandidate {
        CalendarEventCandidate(
            identifier: identifier,
            title: title,
            start: now.addingTimeInterval(startOffset),
            end: now.addingTimeInterval(startOffset + 30 * 60),
            isAllDay: isAllDay,
            attendees: [],
            joinURL: joinURL,
            isCanceled: isCanceled,
            isDeclined: isDeclined
        )
    }

    func testSchedulesOneMinuteBeforeJoinableEventWithoutAttendees() {
        let reminder = CalendarMeetingReminderPlanner.reminders(
            from: [event()],
            now: now
        ).first

        XCTAssertEqual(reminder?.title, "Weekly planning")
        XCTAssertEqual(reminder?.fireDate, now.addingTimeInterval(9 * 60))
        XCTAssertEqual(reminder?.context.detectedApp, "zoom")
        XCTAssertEqual(reminder?.context.suggestedTitle, "Weekly planning")
    }

    func testFinalMinuteSchedulesPromptlyButNeverAfterStart() {
        let reminder = CalendarMeetingReminderPlanner.reminders(
            from: [event(startOffset: 30)],
            now: now
        ).first
        XCTAssertEqual(reminder?.fireDate, now.addingTimeInterval(1))

        XCTAssertTrue(
            CalendarMeetingReminderPlanner.reminders(
                from: [event(startOffset: -1)],
                now: now
            ).isEmpty
        )
    }

    func testSkipsAllDayCanceledDeclinedLinklessAndBeyondHorizonEvents() {
        let events = [
            event(identifier: "all-day", isAllDay: true),
            event(identifier: "canceled", isCanceled: true),
            event(identifier: "declined", isDeclined: true),
            event(identifier: "linkless", joinURL: nil),
            event(identifier: "later", startOffset: 25 * 60 * 60),
        ]
        XCTAssertTrue(CalendarMeetingReminderPlanner.reminders(from: events, now: now).isEmpty)
    }

    func testOccurrenceIdentifierChangesForRecurringInstances() {
        let first = event(identifier: "recurring", startOffset: 10 * 60)
        let second = event(identifier: "recurring", startOffset: 24 * 60 * 60)
        let reminders = CalendarMeetingReminderPlanner.reminders(
            from: [first, second],
            now: now,
            horizon: 25 * 60 * 60
        )
        XCTAssertEqual(reminders.count, 2)
        XCTAssertNotEqual(
            reminders[0].notificationIdentifier,
            reminders[1].notificationIdentifier
        )
    }
}
