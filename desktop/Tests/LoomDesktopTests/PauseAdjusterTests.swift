import CoreMedia
import XCTest
@testable import LoomDesktopApp

/// Locks the PTS-adjustment math used by MicrophoneCaptureCoordinator
/// (and friends) when the user pauses a recording. The math runs
/// per-sample on the audio tap thread, so a regression here would
/// silently desync timestamps; tests are cheap and high-leverage.
final class PauseAdjusterTests: XCTestCase {
    func testPassesThroughTimestampsWhenNeverPaused() {
        var adjuster = PauseAdjuster()
        let pts = CMTime(value: 48_000, timescale: 48_000)
        XCTAssertEqual(adjuster.adjust(rawPTS: pts), pts)
    }

    func testReturnsNilWhilePaused() {
        var adjuster = PauseAdjuster()
        adjuster.pause(atRawPTS: CMTime(value: 1_000, timescale: 48_000))
        XCTAssertNil(adjuster.adjust(rawPTS: CMTime(value: 2_000, timescale: 48_000)))
        XCTAssertNil(adjuster.adjust(rawPTS: CMTime(value: 3_000, timescale: 48_000)))
    }

    func testSubtractsPausedDurationAfterResume() {
        var adjuster = PauseAdjuster()
        // T=1s: pause
        adjuster.pause(atRawPTS: CMTime(seconds: 1.0, preferredTimescale: 48_000))
        // T=4s: resume → 3s pause should be subtracted from now on
        adjuster.resume(atRawPTS: CMTime(seconds: 4.0, preferredTimescale: 48_000))

        // Raw t=4s sample → adjusted t=1s (where we left off)
        let adjusted = adjuster.adjust(rawPTS: CMTime(seconds: 4.0, preferredTimescale: 48_000))
        XCTAssertNotNil(adjusted)
        XCTAssertEqual(adjusted!.seconds, 1.0, accuracy: 0.001)

        // Raw t=5s → adjusted t=2s
        let adjusted2 = adjuster.adjust(rawPTS: CMTime(seconds: 5.0, preferredTimescale: 48_000))
        XCTAssertEqual(adjusted2!.seconds, 2.0, accuracy: 0.001)
    }

    func testAccumulatesMultiplePauses() {
        var adjuster = PauseAdjuster()
        // First pause: 1s → 2s (1s gap)
        adjuster.pause(atRawPTS: CMTime(seconds: 1.0, preferredTimescale: 48_000))
        adjuster.resume(atRawPTS: CMTime(seconds: 2.0, preferredTimescale: 48_000))
        // Second pause: 5s → 8s (3s gap, total now 4s)
        adjuster.pause(atRawPTS: CMTime(seconds: 5.0, preferredTimescale: 48_000))
        adjuster.resume(atRawPTS: CMTime(seconds: 8.0, preferredTimescale: 48_000))

        XCTAssertEqual(adjuster.totalPausedSeconds, 4.0, accuracy: 0.001)
        // Raw t=10s → adjusted t=6s (10 - 4)
        let adjusted = adjuster.adjust(rawPTS: CMTime(seconds: 10.0, preferredTimescale: 48_000))
        XCTAssertEqual(adjusted!.seconds, 6.0, accuracy: 0.001)
    }

    func testDoublePauseIsNoOp() {
        var adjuster = PauseAdjuster()
        adjuster.pause(atRawPTS: CMTime(seconds: 1.0, preferredTimescale: 48_000))
        // Second pause should be ignored; pauseStartPTS stays at 1.0
        adjuster.pause(atRawPTS: CMTime(seconds: 2.0, preferredTimescale: 48_000))
        // Resume at 4s → 3s gap counted (from original pause), not 2s
        adjuster.resume(atRawPTS: CMTime(seconds: 4.0, preferredTimescale: 48_000))
        XCTAssertEqual(adjuster.totalPausedSeconds, 3.0, accuracy: 0.001)
    }

    func testResumeWithoutPauseIsNoOp() {
        var adjuster = PauseAdjuster()
        adjuster.resume(atRawPTS: CMTime(seconds: 5.0, preferredTimescale: 48_000))
        XCTAssertEqual(adjuster.totalPausedSeconds, 0.0)
        XCTAssertFalse(adjuster.isPaused)
    }

    func testIsPausedReflectsState() {
        var adjuster = PauseAdjuster()
        XCTAssertFalse(adjuster.isPaused)
        adjuster.pause(atRawPTS: CMTime(seconds: 1.0, preferredTimescale: 48_000))
        XCTAssertTrue(adjuster.isPaused)
        adjuster.resume(atRawPTS: CMTime(seconds: 2.0, preferredTimescale: 48_000))
        XCTAssertFalse(adjuster.isPaused)
    }
}
