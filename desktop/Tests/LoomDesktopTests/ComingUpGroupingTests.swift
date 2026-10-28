import XCTest
@testable import LoomDesktopApp

final class ComingUpGroupingTests: XCTestCase {
    private let now = ISO8601DateFormatter().date(from: "2026-10-28T19:00:00Z")!
    private var calendar: Calendar = {
        var cal = Calendar(identifier: .gregorian)
        cal.locale = Locale(identifier: "en_US_POSIX")
        cal.timeZone = TimeZone(identifier: "UTC")!
        return cal
    }()

    private func event(_ title: String, _ start: String, minutes: Int = 30, allDay: Bool = false, meeting: Bool = true, identifier: String? = nil) -> CalendarEventCandidate {
        let startDate = ISO8601DateFormatter().date(from: start)!
        return CalendarEventCandidate(
            identifier: identifier ?? title,
            title: title,
            start: startDate,
            end: startDate.addingTimeInterval(Double(minutes) * 60),
            isAllDay: allDay,
            attendees: meeting ? [CalendarAttendee(displayName: "Pat", email: "pat@example.com", isSelf: false)] : [],
            joinURL: nil
        )
    }

    func testHidesSoloBlocksAndDedupesAcrossCalendars() {
        let days = ComingUpGrouping.days(
            from: [
                event("Focus block", "2026-10-28T20:00:00Z", meeting: false),
                event("1:1 with Pat", "2026-10-28T21:00:00Z", identifier: "work-cal"),
                event("1:1 with Pat", "2026-10-28T21:00:00Z", identifier: "personal-cal"),
            ],
            now: now,
            calendar: calendar
        )
        XCTAssertEqual(days.flatMap { $0.events.map(\.title) }, ["1:1 with Pat"])
    }

    func testGroupsByDayAndMarksToday() {
        let days = ComingUpGrouping.days(
            from: [
                event("B", "2026-10-29T15:00:00Z"),
                event("A", "2026-10-28T21:00:00Z"),
            ],
            now: now,
            calendar: calendar
        )
        XCTAssertEqual(days.map(\.dayNumber), ["28", "29"])
        XCTAssertEqual(days.map(\.isToday), [true, false])
        XCTAssertEqual(days[1].weekdayLabel, "Thu")
        XCTAssertEqual(days[1].monthLabel, "October")
        XCTAssertEqual(days[0].events.map(\.title), ["A"])
    }

    func testSkipsPastAllDayAndDeclinedAndCapsTheCount() {
        var events = [
            event("past", "2026-10-28T10:00:00Z"),
            event("allday", "2026-10-29T00:00:00Z", allDay: true),
        ]
        for i in 0..<8 {
            events.append(event("e\(i)", "2026-10-3\(i % 2)T1\(i):00:00Z"))
        }
        let days = ComingUpGrouping.days(from: events, now: now, calendar: calendar)
        let titles = days.flatMap { $0.events.map(\.title) }
        XCTAssertFalse(titles.contains("past"))
        XCTAssertFalse(titles.contains("allday"))
        XCTAssertEqual(titles.count, ComingUpGrouping.eventLimit)
    }

    func testTimeRangeCollapsesSharedPeriod() {
        let e = event("x", "2026-10-28T21:00:00Z")
        XCTAssertEqual(ComingUpGrouping.timeRange(for: e, calendar: calendar), "9:00 – 9:30 PM")
        let crossing = event("y", "2026-10-28T11:45:00Z", minutes: 30)
        XCTAssertEqual(ComingUpGrouping.timeRange(for: crossing, calendar: calendar), "11:45 AM – 12:15 PM")
    }
}
