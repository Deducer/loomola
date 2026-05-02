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
}
