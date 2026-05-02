import XCTest
@testable import LoomDesktopApp

final class ChromeMeetingSignalStoreTests: XCTestCase {
    func testContextFromChromeSignal() {
        let signal = ChromeMeetingSignal(
            event: "meeting-active",
            source: "meet",
            title: "Weekly Sync - meet.google.com",
            tabUrl: "https://meet.google.com/abc-defg-hij",
            ts: 1_714_339_920_000,
            receivedAt: 1_714_339_920_000
        )

        let context = ChromeMeetingSignalStore.context(from: signal)

        XCTAssertEqual(context?.detectedApp, "meet")
        XCTAssertEqual(context?.suggestedTitle, "Weekly Sync")
        XCTAssertEqual(
            context?.sourceContextHint,
            "Google Meet: Weekly Sync - meet.google.com: https://meet.google.com/abc-defg-hij"
        )
    }

    func testReadLatestIgnoresStaleSignal() throws {
        let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let fileURL = directory.appending(path: "chrome-meeting-signal.json")
        let signal = ChromeMeetingSignal(
            event: "meeting-active",
            source: "zoom",
            title: "Zoom Meeting",
            tabUrl: "https://example.zoom.us/wc/123",
            ts: 1_714_339_920_000,
            receivedAt: 1_714_339_920_000
        )
        try JSONEncoder().encode(signal).write(to: fileURL)

        let context = ChromeMeetingSignalStore.readLatest(
            now: Date(timeIntervalSince1970: 1_714_340_200),
            maxAgeSeconds: 120,
            fileURL: fileURL
        )

        XCTAssertNil(context)
    }
}
