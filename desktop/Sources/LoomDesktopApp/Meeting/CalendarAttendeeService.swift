import EventKit
import Foundation
import OSLog

struct CalendarAttendee: Equatable, Sendable {
    let displayName: String
    let email: String?
    let isSelf: Bool
}

struct CalendarEventCandidate: Equatable, Sendable {
    let identifier: String
    let title: String
    let start: Date
    let end: Date
    let isAllDay: Bool
    let attendees: [CalendarAttendee]
    let joinURL: URL?
    let isCanceled: Bool
    let isDeclined: Bool

    var occurrenceIdentifier: String {
        let stableIdentifier = identifier.isEmpty ? title : identifier
        return "\(stableIdentifier)|\(Int(start.timeIntervalSince1970))"
    }

    init(
        identifier: String = "",
        title: String,
        start: Date,
        end: Date,
        isAllDay: Bool,
        attendees: [CalendarAttendee],
        joinURL: URL? = nil,
        isCanceled: Bool = false,
        isDeclined: Bool = false
    ) {
        self.identifier = identifier
        self.title = title
        self.start = start
        self.end = end
        self.isAllDay = isAllDay
        self.attendees = attendees
        self.joinURL = joinURL
        self.isCanceled = isCanceled
        self.isDeclined = isDeclined
    }
}

/// Pure event-selection logic, split from EventKit for tests.
enum CalendarAttendeePicker {
    /// How early a recording may start relative to the event ("joining a
    /// couple of minutes before the hour" must still match).
    static let earlyJoinGrace: TimeInterval = 5 * 60

    /// Picks the meeting the user is most plausibly in at `now` and returns
    /// its attendees excluding the user themself. When events overlap (a 1:1
    /// inside a blocked-out afternoon), joinable conference events win,
    /// followed by attendee events, then the latest-starting event.
    static func attendeesForCurrentMeeting(
        events: [CalendarEventCandidate],
        now: Date
    ) -> [CalendarAttendee] {
        guard let best = bestCurrentEvent(events: events, now: now) else {
            return []
        }
        return dedupedAttendees(of: best)
    }

    /// The event itself (not just its attendees) — the Today pill needs
    /// the title/time provenance.
    static func bestCurrentEvent(
        events: [CalendarEventCandidate],
        now: Date
    ) -> CalendarEventCandidate? {
        let candidates = events.filter { event in
            !event.isAllDay
                && !event.isCanceled
                && !event.isDeclined
                && isMeetingLike(event)
                && event.start <= now.addingTimeInterval(earlyJoinGrace)
                && event.end >= now
        }
        return candidates.max { lhs, rhs in
            let lhsScore = meetingSpecificityScore(lhs)
            let rhsScore = meetingSpecificityScore(rhs)
            return lhsScore == rhsScore ? lhs.start < rhs.start : lhsScore < rhsScore
        }
    }

    private static func meetingSpecificityScore(_ event: CalendarEventCandidate) -> Int {
        if event.joinURL != nil { return 2 }
        if event.attendees.contains(where: { !$0.isSelf }) { return 1 }
        return 0
    }

    static func isMeetingLike(_ event: CalendarEventCandidate) -> Bool {
        event.joinURL != nil || event.attendees.contains(where: { !$0.isSelf })
    }

    static func dedupedAttendees(of event: CalendarEventCandidate) -> [CalendarAttendee] {
        var seenKeys = Set<String>()
        var result: [CalendarAttendee] = []
        for attendee in event.attendees where !attendee.isSelf {
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
            NotificationCenter.default.post(
                name: CalendarReminderPreferences.changed,
                object: nil
            )
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
        matchedMeeting(now: now)?.attendees ?? []
    }

    /// The matched event with its attendees — provenance for the Today
    /// pill rides along with the attendee auto-attach.
    func matchedMeeting(now: Date = Date()) -> (event: CalendarEventCandidate, attendees: [CalendarAttendee])? {
        guard hasAccess else { return nil }
        let candidates = eventCandidates(now: now)
        guard let best = CalendarAttendeePicker.bestCurrentEvent(events: candidates, now: now) else {
            log.notice("calendar attendee lookup → no matching event from \(candidates.count, privacy: .public) candidate(s)")
            return nil
        }
        let attendees = CalendarAttendeePicker.dedupedAttendees(of: best)
        log.notice("calendar attendee lookup → \(attendees.count, privacy: .public) attendee(s) from \(best.title, privacy: .public)")
        return (best, attendees)
    }

    /// Today's meeting-like events. A conferencing link is enough even when
    /// EventKit exposes no invitees, while personal routine blocks stay out
    /// of the picker.
    func eventsToday(now: Date = Date()) -> [CalendarEventCandidate] {
        guard hasAccess else { return [] }
        let calendar = Calendar.current
        let startOfDay = calendar.startOfDay(for: now)
        let predicate = store.predicateForEvents(
            withStart: startOfDay,
            end: startOfDay.addingTimeInterval(24 * 60 * 60),
            calendars: nil
        )
        return store.events(matching: predicate)
            .filter { !$0.isAllDay }
            .map(Self.candidate(from:))
            .filter { !$0.isCanceled && !$0.isDeclined }
            .filter(CalendarAttendeePicker.isMeetingLike)
            .sorted { $0.start < $1.start }
    }

    /// Future events considered by the local reminder scheduler. Eligibility
    /// stays in the pure planner so it can be tested without EventKit.
    func eventsStarting(
        after now: Date = Date(),
        before end: Date
    ) -> [CalendarEventCandidate] {
        guard hasAccess else { return [] }
        let predicate = store.predicateForEvents(
            withStart: now,
            end: end,
            calendars: nil
        )
        return store.events(matching: predicate)
            .map(Self.candidate(from:))
            .filter { $0.start > now && $0.start <= end }
            .sorted { $0.start < $1.start }
    }

    private func eventCandidates(now: Date) -> [CalendarEventCandidate] {
        // Window: long-running events that started hours ago should still
        // match, so look back far and forward just past the join grace.
        let predicate = store.predicateForEvents(
            withStart: now.addingTimeInterval(-8 * 60 * 60),
            end: now.addingTimeInterval(CalendarAttendeePicker.earlyJoinGrace + 60),
            calendars: nil
        )
        return store.events(matching: predicate).map(Self.candidate(from:))
    }

    private static func candidate(from event: EKEvent) -> CalendarEventCandidate {
        let haystack = [
            event.url?.absoluteString,
            event.location,
            event.notes,
        ].compactMap { $0 }.joined(separator: "\n")
        return CalendarEventCandidate(
            identifier: event.eventIdentifier ?? event.calendarItemIdentifier,
            title: event.title ?? "",
            start: event.startDate,
            end: event.endDate,
            isAllDay: event.isAllDay,
            attendees: (event.attendees ?? []).compactMap(Self.attendee(from:)),
            joinURL: ConferenceLink.extract(from: haystack),
            isCanceled: event.status == .canceled,
            isDeclined: event.attendees?.contains {
                $0.isCurrentUser && $0.participantStatus == .declined
            } == true
        )
    }

    /// The conferencing link (Zoom/Meet/Teams/FaceTime/Webex) of the
    /// calendar event the user is most plausibly in right now — the
    /// Granola behavior: "Join meeting" opens the ACTUAL meeting from
    /// the invite, regardless of how the meeting was detected. Nil when
    /// no access, no matching event, or no recognizable link.
    func joinURLForCurrentMeeting(now: Date = Date()) -> URL? {
        guard hasAccess else { return nil }
        let candidates = eventCandidates(now: now).filter { $0.joinURL != nil }
        guard let best = CalendarAttendeePicker.bestCurrentEvent(events: candidates, now: now) else {
            return nil
        }
        log.notice("calendar join-url lookup → \(best.joinURL?.host ?? "none", privacy: .public) from event \(best.title, privacy: .public)")
        return best.joinURL
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
