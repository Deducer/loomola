import XCTest
@testable import LoomDesktopApp

final class CalendarAttendeePickerTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)

    private func event(
        startOffsetMin: Double,
        endOffsetMin: Double,
        isAllDay: Bool = false,
        attendees: [CalendarAttendee]
    ) -> CalendarEventCandidate {
        CalendarEventCandidate(
            title: "Event",
            start: now.addingTimeInterval(startOffsetMin * 60),
            end: now.addingTimeInterval(endOffsetMin * 60),
            isAllDay: isAllDay,
            attendees: attendees
        )
    }

    private func person(_ name: String, email: String? = nil, isSelf: Bool = false) -> CalendarAttendee {
        CalendarAttendee(displayName: name, email: email, isSelf: isSelf)
    }

    func testPicksCurrentMeetingAndExcludesSelf() {
        let events = [
            event(startOffsetMin: -10, endOffsetMin: 20, attendees: [
                person("Me", email: "ian@example.com", isSelf: true),
                person("Jack", email: "jack@example.com"),
            ])
        ]
        let out = CalendarAttendeePicker.attendeesForCurrentMeeting(events: events, now: now)
        XCTAssertEqual(out.map(\.displayName), ["Jack"])
    }

    func testMatchesEventStartingWithinJoinGrace() {
        let events = [
            event(startOffsetMin: 4, endOffsetMin: 34, attendees: [person("Jack", email: "j@x.com")])
        ]
        XCTAssertEqual(
            CalendarAttendeePicker.attendeesForCurrentMeeting(events: events, now: now).count,
            1
        )
    }

    func testIgnoresFutureEndedAllDayAndSoloEvents() {
        let events = [
            event(startOffsetMin: 30, endOffsetMin: 60, attendees: [person("Future", email: "f@x.com")]),
            event(startOffsetMin: -60, endOffsetMin: -10, attendees: [person("Past", email: "p@x.com")]),
            event(startOffsetMin: -10, endOffsetMin: 20, isAllDay: true, attendees: [person("AllDay", email: "a@x.com")]),
            event(startOffsetMin: -10, endOffsetMin: 20, attendees: [person("Just Me", isSelf: true)]),
        ]
        XCTAssertEqual(
            CalendarAttendeePicker.attendeesForCurrentMeeting(events: events, now: now),
            []
        )
    }

    func testOverlappingEventsPreferLatestStart() {
        // A 1:1 inside a blocked-out afternoon: the 1:1 is the meeting.
        let events = [
            event(startOffsetMin: -120, endOffsetMin: 120, attendees: [person("Block", email: "block@x.com")]),
            event(startOffsetMin: -5, endOffsetMin: 25, attendees: [person("Jack", email: "jack@x.com")]),
        ]
        let out = CalendarAttendeePicker.attendeesForCurrentMeeting(events: events, now: now)
        XCTAssertEqual(out.map(\.displayName), ["Jack"])
    }

    func testDedupesAttendeesByEmailThenName() {
        let events = [
            event(startOffsetMin: -10, endOffsetMin: 20, attendees: [
                person("Jack Roberts", email: "jack@x.com"),
                person("J. Roberts", email: "JACK@x.com"),
                person("Maria"),
                person("maria"),
            ])
        ]
        let out = CalendarAttendeePicker.attendeesForCurrentMeeting(events: events, now: now)
        XCTAssertEqual(out.count, 2)
    }

    func testEmailExtractionFromParticipantURL() {
        XCTAssertEqual(
            CalendarAttendeeService.email(fromParticipantURL: URL(string: "mailto:Jack@Example.com")!),
            "jack@example.com"
        )
        XCTAssertNil(
            CalendarAttendeeService.email(fromParticipantURL: URL(string: "https://example.com")!)
        )
        XCTAssertNil(
            CalendarAttendeeService.email(fromParticipantURL: URL(string: "mailto:not-an-address")!)
        )
    }
}
