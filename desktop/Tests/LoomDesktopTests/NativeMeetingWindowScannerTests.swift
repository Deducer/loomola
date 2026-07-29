import XCTest
@testable import LoomDesktopApp

final class NativeMeetingWindowScannerTests: XCTestCase {
    func testDetectsActiveZoomMeetingWindow() {
        let context = NativeMeetingWindowScanner.detect(from: [
            WindowSource(id: 1, title: "Zoom Meeting", applicationName: "zoom.us")
        ])
        XCTAssertEqual(context?.detectedApp, "zoom")
        XCTAssertEqual(context?.bundleIdentifier, "us.zoom.xos")
    }

    func testIgnoresZoomHomeWindow() {
        XCTAssertNil(NativeMeetingWindowScanner.detect(from: [
            WindowSource(id: 1, title: "Zoom Workplace", applicationName: "zoom.us")
        ]))
    }

    func testIgnoresTeamsWhenNotInCall() {
        XCTAssertNil(NativeMeetingWindowScanner.detect(from: [
            WindowSource(id: 1, title: "Chat", applicationName: "Microsoft Teams")
        ]))
    }
}
