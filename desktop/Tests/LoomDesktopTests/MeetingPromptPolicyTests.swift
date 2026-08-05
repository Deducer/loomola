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
                suppressedIdentity: nil,
                activeRecordingKind: nil
            )
        )
        XCTAssertFalse(
            MeetingPromptPolicy.shouldPresent(
                context: context,
                suppressedIdentity: context.meetingPromptIdentity,
                activeRecordingKind: nil
            )
        )
        XCTAssertFalse(
            MeetingPromptPolicy.shouldPresent(
                context: context,
                suppressedIdentity: nil,
                activeRecordingKind: .audio
            )
        )
    }

    func testBriefDetectionGapDoesNotResetSuppression() {
        let missingSince = Date(timeIntervalSince1970: 1_800_000_000)

        XCTAssertFalse(
            MeetingPromptPolicy.shouldClearSuppression(
                absenceStartedAt: missingSince,
                now: missingSince.addingTimeInterval(45)
            )
        )
        XCTAssertTrue(
            MeetingPromptPolicy.shouldClearSuppression(
                absenceStartedAt: missingSince,
                now: missingSince.addingTimeInterval(60)
            )
        )
    }
}
