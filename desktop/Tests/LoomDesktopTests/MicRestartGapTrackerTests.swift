import AVFoundation
import XCTest
@testable import LoomDesktopApp

/// Mic survives a device change mid-note: the restart gap is filled with
/// silence so the mic track stays aligned with the system track.
final class MicRestartGapTrackerTests: XCTestCase {
    func testGapIsTimeBetweenLastAudioAndNewAudio() {
        var tracker = MicRestartGapTracker()
        tracker.markBuffer(uptime: 100, pausedTotal: 0)
        tracker.open()
        XCTAssertTrue(tracker.isOpen)
        // New buffer (0.1 s long) arrives at 103.6 → its audio began at 103.5.
        let silence = tracker.close(arrivalUptime: 103.6, bufferDuration: 0.1, pausedTotal: 0)
        XCTAssertEqual(silence, 3.5, accuracy: 0.0001)
        XCTAssertFalse(tracker.isOpen)
    }

    func testPausedTimeDuringTheGapIsNotFilled() {
        var tracker = MicRestartGapTracker()
        tracker.markBuffer(uptime: 100, pausedTotal: 5)
        tracker.open()
        // 20 s of the gap was a user pause (paused total 5 → 25).
        let silence = tracker.close(arrivalUptime: 130.1, bufferDuration: 0.1, pausedTotal: 25)
        XCTAssertEqual(silence, 10, accuracy: 0.0001)
    }

    /// Review finding P2: the user pauses at 101, the device changes at
    /// 110 while still paused, and they resume at 120. Only the 1 s of
    /// unpaused time (100→101) is missing from the mic file — the system
    /// file also skipped the pause. The old tracker read the paused total
    /// when the restart happened (9 s) instead of at the last buffer (0 s)
    /// and inserted 10 s of silence, pushing the mic 9 s behind the call.
    func testPauseThatBeganBeforeTheRestartIsNotFilled() {
        var tracker = MicRestartGapTracker()
        tracker.markBuffer(uptime: 100, pausedTotal: 0)
        // (pause starts at 101; no buffers while paused)
        tracker.open() // restart at 110, paused total is 9 by now
        let silence = tracker.close(arrivalUptime: 120.1, bufferDuration: 0.1, pausedTotal: 19)
        XCTAssertEqual(silence, 1, accuracy: 0.0001)
    }

    func testRetriedRestartKeepsTheOriginalGapStart() {
        var tracker = MicRestartGapTracker()
        tracker.markBuffer(uptime: 100, pausedTotal: 0)
        tracker.open()
        tracker.markBuffer(uptime: 104, pausedTotal: 0)
        tracker.open()
        XCTAssertEqual(tracker.gapStartUptime, 100)
    }

    func testJitterAndClosedGapsInsertNothing() {
        var tracker = MicRestartGapTracker()
        XCTAssertEqual(tracker.close(arrivalUptime: 10, bufferDuration: 0.1, pausedTotal: 0), 0)
        tracker.open() // no audio yet: nothing to align
        XCTAssertFalse(tracker.isOpen)
        tracker.markBuffer(uptime: 100, pausedTotal: 0)
        tracker.open()
        XCTAssertEqual(tracker.close(arrivalUptime: 100.12, bufferDuration: 0.1, pausedTotal: 0), 0)
    }

    /// Review finding P1: stop() during a restart. A restart queued before
    /// stop (or a retry after a failed restart) must be obsolete once the
    /// note stops — it may not start an engine or reopen the writer.
    func testStopInvalidatesAnInFlightRestart() {
        var gate = MicRestartGate()
        let ticket = gate.begin()
        XCTAssertNotNil(ticket)
        gate.stop()
        XCTAssertFalse(gate.isCurrent(ticket!))
        XCTAssertNil(gate.begin(), "no new restart may start after stop")
    }

    func testFailedRestartRetryIsObsoleteAfterStop() {
        var gate = MicRestartGate()
        let ticket = gate.begin()!
        gate.finishAttempt() // restart failed; a retry is scheduled with `ticket`
        XCTAssertTrue(gate.isCurrent(ticket))
        gate.stop()
        XCTAssertFalse(gate.isCurrent(ticket))
    }

    func testOneRestartAtATimeAndNewNoteGetsFreshGeneration() {
        var gate = MicRestartGate()
        let first = gate.begin()!
        XCTAssertNil(gate.begin(), "a second restart can't overlap the first")
        gate.finishAttempt()
        gate.stop()
        gate.reset() // next note
        let next = gate.begin()!
        XCTAssertNotEqual(first, next)
        XCTAssertFalse(gate.isCurrent(first))
        XCTAssertTrue(gate.isCurrent(next))
    }

    func testWriterAppendSilenceExtendsTheFile() async throws {
        let url = FileManager.default.temporaryDirectory
            .appending(path: "mic-gap-fill-\(UUID()).m4a")
        defer { try? FileManager.default.removeItem(at: url) }

        let writer = try AudioAssetWriter(outputURL: url, sampleRate: 48_000, channelCount: 1)
        try writer.start()
        let format = AVAudioFormat(standardFormatWithSampleRate: 48_000, channels: 1)!
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 24_000)!
        buffer.frameLength = 24_000
        try writer.append(buffer)                 // 0.5 s of audio
        try writer.appendSilence(seconds: 2)      // restart gap
        try writer.append(buffer)                 // 0.5 s after the restart
        _ = try await writer.finish()

        let file = try AVAudioFile(forReading: url)
        let seconds = Double(file.length) / file.fileFormat.sampleRate
        XCTAssertEqual(seconds, 3.0, accuracy: 0.1)
    }

    func testAppendSilenceBeforeAnyAudioIsANoOp() throws {
        let url = FileManager.default.temporaryDirectory
            .appending(path: "mic-gap-fill-\(UUID()).m4a")
        defer { try? FileManager.default.removeItem(at: url) }
        let writer = try AudioAssetWriter(outputURL: url, sampleRate: 48_000, channelCount: 1)
        XCTAssertNoThrow(try writer.appendSilence(seconds: 1))
        XCTAssertEqual(writer.writeHealth.framesWritten, 0)
    }
}
