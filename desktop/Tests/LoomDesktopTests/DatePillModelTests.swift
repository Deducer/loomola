import XCTest
@testable import LoomDesktopApp

final class DatePillModelTests: XCTestCase {
    private let now = ISO8601DateFormatter().date(from: "2026-10-28T19:00:00Z")!
    private var utc: Calendar = {
        var cal = Calendar(identifier: .gregorian)
        cal.locale = Locale(identifier: "en_US_POSIX")
        cal.timeZone = TimeZone(identifier: "UTC")!
        return cal
    }()

    func testDatePillLabels() {
        XCTAssertEqual(DatePillModel.label(for: now.addingTimeInterval(-3600), now: now, calendar: utc), "Today")
        XCTAssertEqual(DatePillModel.label(for: now.addingTimeInterval(-86_400), now: now, calendar: utc), "Yesterday")
        XCTAssertEqual(DatePillModel.label(for: now.addingTimeInterval(-2 * 86_400), now: now, calendar: utc), "Mon, Oct 26")
        XCTAssertEqual(DatePillModel.label(for: now.addingTimeInterval(-400 * 86_400), now: now, calendar: utc), "Tue, Sep 23, 2025")
    }
}
