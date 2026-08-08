import XCTest
@testable import LoomDesktopApp

final class MeetingPromptPolicyTests: XCTestCase {
    func testNativeMeetingIdentitySurvivesWindowAndCalendarTitleChanges() {
        let first = MeetingContext(
            detectedApp: "zoom",
            sourceContextHint: "zoom.us: Zoom Meeting",
            suggestedTitle: "Zoom meeting",
            joinURL: URL(string: "https://zoom.us/j/111"),
            bundleIdentifier: "us.zoom.xos"
        )
        let enriched = MeetingContext(
            detectedApp: "zoom",
            sourceContextHint: "zoom.us: Floating Video Window",
            suggestedTitle: "Weekly planning",
            joinURL: URL(string: "https://zoom.us/j/222"),
            bundleIdentifier: "us.zoom.xos"
        )

        XCTAssertEqual(first.meetingPromptIdentity, enriched.meetingPromptIdentity)
    }

    func testBrowserMeetingIdentityUsesJoinURLToDistinguishCalls() {
        let first = MeetingContext(
            detectedApp: "google-meet",
            sourceContextHint: "Chrome: First call",
            suggestedTitle: "First call",
            joinURL: URL(string: "https://meet.google.com/abc-defg-hij"),
            bundleIdentifier: "com.google.Chrome"
        )
        let second = MeetingContext(
            detectedApp: "google-meet",
            sourceContextHint: "Chrome: Second call",
            suggestedTitle: "Second call",
            joinURL: URL(string: "https://meet.google.com/xyz-abcd-efg"),
            bundleIdentifier: "com.google.Chrome"
        )

        XCTAssertNotEqual(first.meetingPromptIdentity, second.meetingPromptIdentity)
    }

    func testPolicySuppressesHandledOrActivelyRecordedMeeting() {
        let context = MeetingContext(
            detectedApp: "zoom",
            sourceContextHint: "zoom.us: Zoom Meeting",
            suggestedTitle: "Weekly planning",
            joinURL: nil,
            bundleIdentifier: "us.zoom.xos"
        )

        XCTAssertTrue(
            MeetingPromptPolicy.shouldPresent(
                context: context,
                suppression: nil,
                activeRecordingKind: nil
            )
        )
        let suppression = MeetingPromptPolicy.suppression(for: context)
        XCTAssertFalse(
            MeetingPromptPolicy.shouldPresent(
                context: context,
                suppression: suppression,
                activeRecordingKind: nil
            )
        )
        XCTAssertFalse(
            MeetingPromptPolicy.shouldPresent(
                context: context,
                suppression: nil,
                activeRecordingKind: .audio
            )
        )
    }

    func testDismissedNativeCallStaysSuppressedAcrossCalendarAndWindowFlicker() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let scheduled = MeetingContext(
            detectedApp: "zoom",
            sourceContextHint: "zoom.us: Zoom Meeting",
            suggestedTitle: "Editing Review",
            joinURL: URL(string: "https://zoom.us/j/111"),
            bundleIdentifier: "us.zoom.xos",
            calendarEventOccurrenceIdentifier: "editing-review|1800000000",
            calendarEventEnd: now.addingTimeInterval(60 * 60)
        )
        let windowOnly = MeetingContext(
            detectedApp: "zoom",
            sourceContextHint: "zoom.us: Floating Video Window",
            suggestedTitle: "Zoom meeting",
            joinURL: nil,
            bundleIdentifier: "us.zoom.xos"
        )
        let suppression = MeetingPromptPolicy.suppression(for: scheduled, now: now)

        XCTAssertFalse(
            MeetingPromptPolicy.shouldPresent(
                context: windowOnly,
                suppression: suppression,
                activeRecordingKind: nil,
                now: now.addingTimeInterval(90 * 60)
            )
        )
    }

    func testDifferentScheduledCallInSameNativeAppCanPrompt() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let first = MeetingContext(
            detectedApp: "zoom",
            sourceContextHint: "zoom.us: Zoom Meeting",
            suggestedTitle: "First call",
            joinURL: URL(string: "https://zoom.us/j/111"),
            bundleIdentifier: "us.zoom.xos",
            calendarEventOccurrenceIdentifier: "first|1800000000",
            calendarEventEnd: now.addingTimeInterval(30 * 60)
        )
        let second = MeetingContext(
            detectedApp: "zoom",
            sourceContextHint: "zoom.us: Zoom Meeting",
            suggestedTitle: "Second call",
            joinURL: URL(string: "https://zoom.us/j/222"),
            bundleIdentifier: "us.zoom.xos",
            calendarEventOccurrenceIdentifier: "second|1800003600",
            calendarEventEnd: now.addingTimeInterval(90 * 60)
        )

        XCTAssertTrue(
            MeetingPromptPolicy.shouldPresent(
                context: second,
                suppression: MeetingPromptPolicy.suppression(for: first, now: now),
                activeRecordingKind: nil,
                now: now.addingTimeInterval(60 * 60)
            )
        )
    }

    func testUnscheduledSuppressionEventuallyExpires() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let context = MeetingContext(
            detectedApp: "zoom",
            sourceContextHint: "zoom.us: Zoom Meeting",
            suggestedTitle: "Zoom meeting",
            joinURL: nil,
            bundleIdentifier: "us.zoom.xos"
        )
        let suppression = MeetingPromptPolicy.suppression(for: context, now: now)

        XCTAssertTrue(
            MeetingPromptPolicy.shouldPresent(
                context: context,
                suppression: suppression,
                activeRecordingKind: nil,
                now: now.addingTimeInterval(MeetingPromptPolicy.fallbackSuppressionInterval)
            )
        )
    }
}
