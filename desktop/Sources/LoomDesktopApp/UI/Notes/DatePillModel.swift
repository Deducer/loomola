import Foundation

/// Label for the note header's trailing date pill (Granola: "Today",
/// "Yesterday", otherwise "Mon, Oct 26"). Pure so the parity audit's
/// stale-"Today" bug has a test.
enum DatePillModel {
    static func label(
        for date: Date,
        now: Date = Date(),
        calendar: Calendar = .current
    ) -> String {
        let today = calendar.startOfDay(for: now)
        if calendar.isDate(date, inSameDayAs: today) { return "Today" }
        if let yesterday = calendar.date(byAdding: .day, value: -1, to: today),
           calendar.isDate(date, inSameDayAs: yesterday) {
            return "Yesterday"
        }
        let format = calendar.isDate(date, equalTo: now, toGranularity: .year)
            ? "EEE, MMM d"
            : "EEE, MMM d, yyyy"
        return RecentDateGrouping.formatter(format: format, calendar: calendar).string(from: date)
    }
}
