import EventKit
import Foundation
import OSLog

struct CalendarAttendee: Equatable, Sendable {
    let displayName: String
    let email: String?
    let isSelf: Bool
}

struct CalendarEventCandidate: Equatable, Sendable {
    let title: String
    let start: Date
    let end: Date
    let isAllDay: Bool
    let attendees: [CalendarAttendee]
}

/// Pure event-selection logic, split from EventKit for tests.
enum CalendarAttendeePicker {
    /// How early a recording may start relative to the event ("joining a
    /// couple of minutes before the hour" must still match).
    static let earlyJoinGrace: TimeInterval = 5 * 60

    /// Picks the meeting the user is most plausibly in at `now` and returns
    /// its attendees excluding the user themself. All-day events and events
    /// with no other attendees never match. When events overlap (a 1:1
    /// inside a blocked-out afternoon), the latest-starting one wins — it's
    /// the most specific.
    static func attendeesForCurrentMeeting(
        events: [CalendarEventCandidate],
        now: Date
    ) -> [CalendarAttendee] {
        let candidates = events.filter { event in
            !event.isAllDay
                && event.start <= now.addingTimeInterval(earlyJoinGrace)
                && event.end >= now
                && event.attendees.contains { !$0.isSelf }
        }
        guard let best = candidates.max(by: { $0.start < $1.start }) else {
            return []
        }

        var seenKeys = Set<String>()
        var result: [CalendarAttendee] = []
        for attendee in best.attendees where !attendee.isSelf {
            let key = attendee.email?.lowercased()
                ?? "name:\(attendee.displayName.lowercased())"
            guard !key.isEmpty, !seenKeys.contains(key) else { continue }
            seenKeys.insert(key)
            result.append(attendee)
        }
        return result
    }
}

/// EventKit wrapper: permission handling + mapping EKEvents around "now"
/// into plain candidates for the picker.
final class CalendarAttendeeService {
    static let shared = CalendarAttendeeService()
    private let store = EKEventStore()
    private let log = Logger(
        subsystem: "cloud.dissonance.loom.desktop",
        category: "calendar"
    )

    var authorizationStatus: EKAuthorizationStatus {
        EKEventStore.authorizationStatus(for: .event)
    }

    var hasAccess: Bool {
        authorizationStatus == .fullAccess
    }

    @discardableResult
    func requestAccess() async -> Bool {
        do {
            let granted = try await store.requestFullAccessToEvents()
            log.notice("calendar access request → \(granted ? "granted" : "denied", privacy: .public)")
            return granted
        } catch {
            log.error("calendar access request failed: \(error.localizedDescription, privacy: .public)")
            return false
        }
    }

    /// Attendees (excluding self) of the calendar event the user is most
    /// plausibly in right now. Empty when no access, no matching event, or
    /// a solo event.
    func attendeesForCurrentMeeting(now: Date = Date()) -> [CalendarAttendee] {
        guard hasAccess else { return [] }
        // Window: long-running events that started hours ago should still
        // match, so look back far and forward just past the join grace.
        let predicate = store.predicateForEvents(
            withStart: now.addingTimeInterval(-8 * 60 * 60),
            end: now.addingTimeInterval(CalendarAttendeePicker.earlyJoinGrace + 60),
            calendars: nil
        )
        let candidates = store.events(matching: predicate).map { event in
            CalendarEventCandidate(
                title: event.title ?? "",
                start: event.startDate,
                end: event.endDate,
                isAllDay: event.isAllDay,
                attendees: (event.attendees ?? []).compactMap(Self.attendee(from:))
            )
        }
        let attendees = CalendarAttendeePicker.attendeesForCurrentMeeting(
            events: candidates,
            now: now
        )
        log.notice("calendar attendee lookup → \(attendees.count, privacy: .public) attendee(s) from \(candidates.count, privacy: .public) event(s)")
        return attendees
    }

    private static func attendee(from participant: EKParticipant) -> CalendarAttendee? {
        // Rooms/resources aren't people.
        guard participant.participantType == .person else { return nil }
        let email = Self.email(fromParticipantURL: participant.url)
        let name = participant.name?.trimmingCharacters(in: .whitespaces) ?? ""
        if name.isEmpty && email == nil { return nil }
        return CalendarAttendee(
            displayName: name.isEmpty ? (email ?? "") : name,
            email: email,
            isSelf: participant.isCurrentUser
        )
    }

    static func email(fromParticipantURL url: URL) -> String? {
        // EKParticipant.url is mailto:address for human attendees.
        guard url.scheme?.lowercased() == "mailto" else { return nil }
        let address = url.absoluteString.dropFirst("mailto:".count)
        let trimmed = address.trimmingCharacters(in: .whitespaces)
        return trimmed.contains("@") ? trimmed.lowercased() : nil
    }
}
