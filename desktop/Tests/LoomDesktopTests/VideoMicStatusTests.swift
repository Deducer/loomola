import XCTest
@testable import LoomDesktopApp

final class VideoMicStatusTests: XCTestCase {
    private let start = Date(timeIntervalSince1970: 1_000)

    private func at(_ seconds: TimeInterval) -> Date {
        start.addingTimeInterval(seconds)
    }

    private func evaluate(
        current: VideoMicStatus = .starting,
        now: TimeInterval,
        lastWrite: TimeInterval?,
        lastSound: TimeInterval?
    ) -> VideoMicStatus {
        VideoMicStatus.evaluate(
            current: current,
            now: at(now),
            startedAt: start,
            lastWriteAt: lastWrite.map(at),
            lastSoundAt: lastSound.map(at)
        )
    }

    func testStartingUntilFirstWriteWithinGrace() {
        XCTAssertEqual(evaluate(now: 5, lastWrite: nil, lastSound: nil), .starting)
    }

    func testNoMicWhenNothingWrittenAfterGrace() {
        XCTAssertEqual(evaluate(now: 11, lastWrite: nil, lastSound: nil), .noMic)
    }

    func testFailedStartStaysNoMicBeforeGrace() {
        XCTAssertEqual(evaluate(current: .noMic, now: 2, lastWrite: nil, lastSound: nil), .noMic)
    }

    func testLiveWhenWritingAndRecentSound() {
        XCTAssertEqual(evaluate(now: 30, lastWrite: 29.5, lastSound: 25), .live)
    }

    func testLiveRightAfterStartBeforeAnyoneSpeaks() {
        XCTAssertEqual(evaluate(now: 4, lastWrite: 3.8, lastSound: nil), .live)
    }

    func testQuietAfterLongSilenceWhileWriting() {
        XCTAssertEqual(evaluate(now: 30, lastWrite: 29.5, lastSound: 15), .quiet)
        XCTAssertEqual(evaluate(now: 30, lastWrite: 29.5, lastSound: nil), .quiet)
    }

    func testNoMicWhenWritesStall() {
        XCTAssertEqual(evaluate(current: .live, now: 30, lastWrite: 26, lastSound: 26), .noMic)
    }

    func testRecoversToLiveWhenWritesResume() {
        XCTAssertEqual(evaluate(current: .noMic, now: 40, lastWrite: 39.9, lastSound: 39), .live)
    }
}
