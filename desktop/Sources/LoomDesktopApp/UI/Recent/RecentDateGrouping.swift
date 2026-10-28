import Foundation

/// Pure logic for grouping `RecentRecording`s into date sections
/// (Today / Yesterday / Mon, May 4 / Apr 30 / Dec 12, 2025) for the
/// Recent notes list. Lifted out of `RecentStrip` so it can be unit
/// tested without spinning up a SwiftUI view tree.
///
/// `now` and `calendar` are parameterized so tests can pin them
/// instead of relying on the system clock.
///
/// Formatters are cached per calendar: `grouped` runs inside a SwiftUI
/// body, and allocating a `DateFormatter` per row per render pinned the
/// main thread at 100% during a recording (found in the 2026-10-28
/// parity audit).
enum RecentDateGrouping {
    struct Group: Equatable {
        let label: String
        let items: [RecentRecording]
    }

    /// Groups items by day, sorted reverse-chronologically. Each
    /// group's items are also reverse-chronological within the day.
    /// Date headers are localized labels:
    ///   • "Today" / "Yesterday" for the two most recent days
    ///   • "EEE, MMM d" for items 2–6 days back ("Mon, May 4")
    ///   • "MMM d" for older items in the current year ("Apr 30")
    ///   • "MMM d, yyyy" for items in a prior year ("Dec 12, 2025")
    static func grouped(
        _ items: [RecentRecording],
        now: Date = Date(),
        calendar: Calendar = .current
    ) -> [Group] {
        let today = calendar.startOfDay(for: now)
        let yesterday = calendar.date(byAdding: .day, value: -1, to: today) ?? today

        // Insertion-ordered buckets so the output preserves the
        // reverse-chronological item order (newest groups first).
        var labels: [String] = []
        var bucket: [String: [RecentRecording]] = [:]

        for item in items.sorted(by: { $0.createdAt > $1.createdAt }) {
            let groupLabel = label(
                for: item.createdAt,
                now: now,
                today: today,
                yesterday: yesterday,
                calendar: calendar
            )
            if bucket[groupLabel] == nil {
                bucket[groupLabel] = []
                labels.append(groupLabel)
            }
            bucket[groupLabel]?.append(item)
        }

        return labels.map { Group(label: $0, items: bucket[$0] ?? []) }
    }

    /// Localized header label for a single date. Pulled out of
    /// `grouped` so tests can hit it directly.
    static func label(
        for date: Date,
        now: Date = Date(),
        calendar: Calendar = .current
    ) -> String {
        let today = calendar.startOfDay(for: now)
        let yesterday = calendar.date(byAdding: .day, value: -1, to: today) ?? today
        return label(for: date, now: now, today: today, yesterday: yesterday, calendar: calendar)
    }

    private static func label(
        for date: Date,
        now: Date,
        today: Date,
        yesterday: Date,
        calendar: Calendar
    ) -> String {
        if calendar.isDate(date, inSameDayAs: today) { return "Today" }
        if calendar.isDate(date, inSameDayAs: yesterday) { return "Yesterday" }
        let daysAgo =
            calendar.dateComponents(
                [.day],
                from: calendar.startOfDay(for: date),
                to: today
            ).day ?? 0
        let format: String
        if daysAgo < 7 {
            format = "EEE, MMM d"   // "Mon, May 4"
        } else if calendar.isDate(date, equalTo: now, toGranularity: .year) {
            format = "MMM d"        // "Apr 30"
        } else {
            format = "MMM d, yyyy"  // "Dec 12, 2025"
        }
        return formatter(format: format, calendar: calendar).string(from: date)
    }

    // MARK: - Formatter cache

    private struct FormatterKey: Hashable {
        let format: String
        let calendar: Calendar.Identifier
        let locale: String
        let timeZone: String
    }

    private static let cacheLock = NSLock()
    private static var cache: [FormatterKey: DateFormatter] = [:]

    /// One formatter per (format, calendar, locale, time zone). Returns
    /// the same instance on every call so view bodies stay cheap.
    static func formatter(format: String, calendar: Calendar) -> DateFormatter {
        let locale = calendar.locale ?? Locale.current
        let key = FormatterKey(
            format: format,
            calendar: calendar.identifier,
            locale: locale.identifier,
            timeZone: calendar.timeZone.identifier
        )
        cacheLock.lock()
        defer { cacheLock.unlock() }
        if let cached = cache[key] { return cached }
        let formatter = DateFormatter()
        formatter.calendar = calendar
        formatter.locale = locale
        formatter.timeZone = calendar.timeZone
        formatter.dateFormat = format
        cache[key] = formatter
        return formatter
    }
}
