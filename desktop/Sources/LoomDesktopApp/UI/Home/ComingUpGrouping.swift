import Foundation

/// One day row in the home view's "Coming up" card (Granola pattern):
/// a big day numeral, month + weekday stacked beside it, and the
/// day's events.
struct ComingUpDay: Equatable {
    let dayNumber: String
    let monthLabel: String
    let weekdayLabel: String
    let isToday: Bool
    let events: [CalendarEventCandidate]
}

/// Pure grouping for the Coming up card: the next few events, bucketed
/// by calendar day in start order. Parameterized on `now` + `calendar`
/// so tests can pin the clock.
enum ComingUpGrouping {
    /// How many events the card shows before it stops (Granola shows
    /// a handful, not the whole fortnight).
    static let eventLimit = 5
    /// How far ahead to look for those events.
    static let horizonDays = 14

    static func days(
        from events: [CalendarEventCandidate],
        now: Date = Date(),
        calendar: Calendar = .current,
        limit: Int = eventLimit
    ) -> [ComingUpDay] {
        let today = calendar.startOfDay(for: now)
        // Meetings only (attendees or a join link), like Granola's
        // default "hide events with no participants"; the same event on
        // two calendars shows once.
        var seen = Set<String>()
        let upcoming = events
            .filter { !$0.isAllDay && !$0.isCanceled && !$0.isDeclined && $0.end > now }
            .filter(CalendarAttendeePicker.isMeetingLike)
            .sorted { $0.start < $1.start }
            .filter { seen.insert("\($0.title.trimmingCharacters(in: .whitespaces).lowercased())|\(Int($0.start.timeIntervalSince1970))").inserted }
            .prefix(limit)

        var dayOrder: [Date] = []
        var bucket: [Date: [CalendarEventCandidate]] = [:]
        for event in upcoming {
            let day = calendar.startOfDay(for: event.start)
            if bucket[day] == nil {
                bucket[day] = []
                dayOrder.append(day)
            }
            bucket[day]?.append(event)
        }

        let dayFormatter = RecentDateGrouping.formatter(format: "d", calendar: calendar)
        let monthFormatter = RecentDateGrouping.formatter(format: "MMMM", calendar: calendar)
        let weekdayFormatter = RecentDateGrouping.formatter(format: "EEE", calendar: calendar)

        return dayOrder.map { day in
            ComingUpDay(
                dayNumber: dayFormatter.string(from: day),
                monthLabel: monthFormatter.string(from: day),
                weekdayLabel: weekdayFormatter.string(from: day),
                isToday: calendar.isDate(day, inSameDayAs: today),
                events: bucket[day] ?? []
            )
        }
    }

    /// "2:00 – 2:30 PM" style time range for an event row.
    static func timeRange(
        for event: CalendarEventCandidate,
        calendar: Calendar = .current
    ) -> String {
        let timeFormatter = RecentDateGrouping.formatter(format: "h:mm", calendar: calendar)
        let timeWithPeriod = RecentDateGrouping.formatter(format: "h:mm a", calendar: calendar)
        let startPeriod = RecentDateGrouping.formatter(format: "a", calendar: calendar).string(from: event.start)
        let endPeriod = RecentDateGrouping.formatter(format: "a", calendar: calendar).string(from: event.end)
        if startPeriod == endPeriod {
            return "\(timeFormatter.string(from: event.start)) – \(timeWithPeriod.string(from: event.end))"
        }
        return "\(timeWithPeriod.string(from: event.start)) – \(timeWithPeriod.string(from: event.end))"
    }
}
