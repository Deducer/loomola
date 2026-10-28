import XCTest
@testable import LoomDesktopApp

final class RecordingInProgressPillModelTests: XCTestCase {
    func testLabelFallsBackToNewNote() {
        XCTAssertEqual(RecordingInProgressPillModel(title: "").label, "New note")
        XCTAssertEqual(RecordingInProgressPillModel(title: "  \n").label, "New note")
        XCTAssertEqual(RecordingInProgressPillModel(title: "Standup").label, "Standup")
    }

    func testElapsedFormatterRollsIntoHours() {
        XCTAssertEqual(RecordingElapsedFormatter.string(seconds: 0), "00:00")
        XCTAssertEqual(RecordingElapsedFormatter.string(seconds: 65), "01:05")
        XCTAssertEqual(RecordingElapsedFormatter.string(seconds: 3725), "1:02:05")
        XCTAssertEqual(RecordingElapsedFormatter.string(seconds: -3), "00:00")
    }

    func testElapsedExcludesPausedTime() {
        let start = Date(timeIntervalSince1970: 1_000)
        let now = Date(timeIntervalSince1970: 1_100)
        XCTAssertEqual(
            RecordingElapsedFormatter.elapsed(now: now, startedAt: start, pausedAt: nil, pausedAccumulatedSeconds: 10),
            90
        )
        // While paused the clock freezes at the pause moment.
        XCTAssertEqual(
            RecordingElapsedFormatter.elapsed(
                now: now, startedAt: start,
                pausedAt: Date(timeIntervalSince1970: 1_050), pausedAccumulatedSeconds: 0
            ),
            50
        )
    }
}
