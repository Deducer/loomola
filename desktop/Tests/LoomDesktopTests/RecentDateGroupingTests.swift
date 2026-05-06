import XCTest
@testable import LoomDesktopApp

final class RecentDateGroupingTests: XCTestCase {
    // Pinned reference clock so the test suite never depends on
    // wall-clock time. 2026-05-06 14:30:00 UTC, Wednesday.
    private let now = ISO8601DateFormatter().date(from: "2026-05-06T14:30:00Z")!
    private var calendar: Calendar = {
        // Same fixed calendar everywhere — UTC + en_US so day
        // boundaries and weekday names are deterministic across
        // CI machines.
        var cal = Calendar(identifier: .gregorian)
        cal.locale = Locale(identifier: "en_US_POSIX")
        cal.timeZone = TimeZone(identifier: "UTC")!
        return cal
    }()

    // MARK: - Empty + ordering

    func testEmptyInputProducesEmptyGrouping() {
        let groups = RecentDateGrouping.grouped([], now: now, calendar: calendar)
        XCTAssertEqual(groups, [])
    }

    func testItemsAreSortedReverseChronologicallyWithinAndAcrossGroups() {
        let items = [
            recording(id: "old", at: "2026-05-06T08:00:00Z"),
            recording(id: "mid", at: "2026-05-06T12:00:00Z"),
            recording(id: "new", at: "2026-05-06T14:00:00Z"),
            recording(id: "yesterday", at: "2026-05-05T20:00:00Z"),
        ]
        let groups = RecentDateGrouping.grouped(items, now: now, calendar: calendar)
        XCTAssertEqual(groups.map(\.label), ["Today", "Yesterday"])
        XCTAssertEqual(groups[0].items.map(\.id), ["new", "mid", "old"])
        XCTAssertEqual(groups[1].items.map(\.id), ["yesterday"])
    }

    // MARK: - Label semantics

    func testTodayLabelForSameCalendarDay() {
        XCTAssertEqual(
            RecentDateGrouping.label(
                for: parse("2026-05-06T01:00:00Z"),
                now: now,
                calendar: calendar
            ),
            "Today"
        )
    }

    func testYesterdayLabelForPreviousCalendarDay() {
        XCTAssertEqual(
            RecentDateGrouping.label(
                for: parse("2026-05-05T23:59:00Z"),
                now: now,
                calendar: calendar
            ),
            "Yesterday"
        )
    }

    func testWeekdayLabelForItemsTwoToSixDaysOld() {
        // 2026-05-04 is a Monday in our fixed calendar. Should
        // render as "Mon, May 4".
        XCTAssertEqual(
            RecentDateGrouping.label(
                for: parse("2026-05-04T16:00:00Z"),
                now: now,
                calendar: calendar
            ),
            "Mon, May 4"
        )
    }

    func testCurrentYearShortLabelForItemsBeyondAWeek() {
        // 8 days back, same year → "MMM d".
        XCTAssertEqual(
            RecentDateGrouping.label(
                for: parse("2026-04-28T10:00:00Z"),
                now: now,
                calendar: calendar
            ),
            "Apr 28"
        )
    }

    func testPriorYearLabelIncludesYear() {
        // Dec 2025 → "Dec 12, 2025".
        XCTAssertEqual(
            RecentDateGrouping.label(
                for: parse("2025-12-12T10:00:00Z"),
                now: now,
                calendar: calendar
            ),
            "Dec 12, 2025"
        )
    }

    // MARK: - Boundary cases

    func testJustBeforeMidnightTodayIsToday() {
        XCTAssertEqual(
            RecentDateGrouping.label(
                for: parse("2026-05-06T00:00:01Z"),
                now: now,
                calendar: calendar
            ),
            "Today"
        )
    }

    func testJustAfterMidnightYesterdayIsYesterday() {
        XCTAssertEqual(
            RecentDateGrouping.label(
                for: parse("2026-05-05T00:00:01Z"),
                now: now,
                calendar: calendar
            ),
            "Yesterday"
        )
    }

    // 7-days-back is the boundary between weekday-name and short
    // month-day label. Explicit cases on both sides keep the rule
    // honest.
    func testSixDaysAgoUsesWeekdayLabel() {
        let date = calendar.date(byAdding: .day, value: -6, to: now)!
        XCTAssertTrue(
            RecentDateGrouping.label(for: date, now: now, calendar: calendar)
                .hasPrefix("Thu, ")
        )
    }

    func testSevenDaysAgoFallsToMonthDay() {
        let date = calendar.date(byAdding: .day, value: -7, to: now)!
        XCTAssertEqual(
            RecentDateGrouping.label(for: date, now: now, calendar: calendar),
            "Apr 29"
        )
    }

    // MARK: - Helpers

    private func parse(_ iso: String) -> Date {
        ISO8601DateFormatter().date(from: iso)!
    }

    private func recording(id: String, at iso: String) -> RecentRecording {
        RecentRecording(
            dto: RecentRecordingDTO(
                id: id,
                slug: "slug-\(id)",
                title: "Test \(id)",
                kind: "audio",
                createdAt: iso,
                durationSeconds: 30,
                thumbnailUrl: nil,
                folderId: nil,
                folderName: nil
            )
        )!
    }
}
