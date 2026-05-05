import XCTest
@testable import LoomDesktopApp

final class MeetingDetectorTests: XCTestCase {
    func testDetectsGoogleMeetFromBrowserWindowTitle() {
        let context = MeetingDetector.detect(
            applicationName: "Google Chrome",
            title: "Weekly Sync - meet.google.com"
        )

        XCTAssertEqual(context?.detectedApp, "google-meet")
        XCTAssertEqual(context?.sourceContextHint, "Google Chrome: Weekly Sync - meet.google.com")
        XCTAssertEqual(context?.suggestedTitle, "Weekly Sync")
    }

    func testDetectsZoomAndTeams() {
        XCTAssertEqual(
            MeetingDetector.detect(applicationName: "zoom.us", title: "Zoom Meeting")?.detectedApp,
            "zoom"
        )
        XCTAssertEqual(
            MeetingDetector.detect(applicationName: "Microsoft Teams", title: "Daily Standup")?.detectedApp,
            "teams"
        )
    }

    func testIgnoresNonMeetingWindows() {
        XCTAssertNil(MeetingDetector.detect(applicationName: "Notes", title: "Shopping list"))
    }

    func testSuggestedTitleFallsBackWhenWindowTitleIsEmpty() {
        XCTAssertEqual(
            MeetingDetector.suggestedTitle(from: " ", fallback: "Google Meet"),
            "Google Meet"
        )
    }

    func testExtractsMeetURLFromWindowTitle() {
        XCTAssertEqual(
            MeetingDetector.extractMeetURL(from: "Sprint planning - meet.google.com/abc-defg-hij"),
            URL(string: "https://meet.google.com/abc-defg-hij")
        )
    }

    func testExtractMeetURLReturnsNilForNonMeetTitle() {
        XCTAssertNil(
            MeetingDetector.extractMeetURL(from: "Daily Standup - Microsoft Teams")
        )
    }

    func testGoogleMeetContextIncludesJoinURLAndBundleID() {
        let context = MeetingDetector.detect(
            applicationName: "Google Chrome",
            title: "Weekly Sync - meet.google.com/abc-defg-hij"
        )
        XCTAssertEqual(
            context?.joinURL,
            URL(string: "https://meet.google.com/abc-defg-hij")
        )
        XCTAssertEqual(context?.bundleIdentifier, "com.google.Chrome")
    }

    func testZoomContextHasNoJoinURLButHasBundleID() {
        let context = MeetingDetector.detect(
            applicationName: "zoom.us",
            title: "Zoom Meeting"
        )
        XCTAssertNil(context?.joinURL)
        XCTAssertEqual(context?.bundleIdentifier, "us.zoom.xos")
    }
}
