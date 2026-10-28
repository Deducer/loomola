import AVFoundation
import XCTest
@testable import LoomDesktopApp

/// Mic survives a device change mid-note: the restart gap is filled with
/// silence so the mic track stays aligned with the system track.
final class MicRestartGapTrackerTests: XCTestCase {
    func testGapIsTimeBetweenLastAudioAndNewAudio() {
        var tracker = MicRestartGapTracker()
        tracker.markBuffer(uptime: 100, pausedTotal: 0)
        tracker.open(nextEpoch: 1)
        XCTAssertTrue(tracker.isOpen)
        // New buffer (0.1 s long) arrives at 103.6 → its audio began at 103.5.
        let silence = tracker.close(arrivalUptime: 103.6, bufferDuration: 0.1, pausedTotal: 0)
        XCTAssertEqual(silence, 3.5, accuracy: 0.0001)
        XCTAssertFalse(tracker.isOpen)
    }

    func testPausedTimeDuringTheGapIsNotFilled() {
        var tracker = MicRestartGapTracker()
        tracker.markBuffer(uptime: 100, pausedTotal: 5)
        tracker.open(nextEpoch: 1)
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
        tracker.open(nextEpoch: 1) // restart at 110, paused total is 9 by now
        let silence = tracker.close(arrivalUptime: 120.1, bufferDuration: 0.1, pausedTotal: 19)
        XCTAssertEqual(silence, 1, accuracy: 0.0001)
    }

    func testRetriedRestartKeepsTheOriginalGapStart() {
        var tracker = MicRestartGapTracker()
        tracker.markBuffer(uptime: 100, pausedTotal: 0)
        tracker.open(nextEpoch: 1)
        tracker.markBuffer(uptime: 104, pausedTotal: 0)
        tracker.open(nextEpoch: 1)
        XCTAssertEqual(tracker.gapStartUptime, 100)
    }

    func testJitterAndClosedGapsInsertNothing() {
        var tracker = MicRestartGapTracker()
        XCTAssertEqual(tracker.close(arrivalUptime: 10, bufferDuration: 0.1, pausedTotal: 0), 0)
        tracker.open(nextEpoch: 1) // no audio yet: nothing to align
        XCTAssertFalse(tracker.isOpen)
        tracker.markBuffer(uptime: 100, pausedTotal: 0)
        tracker.open(nextEpoch: 1)
        XCTAssertEqual(tracker.close(arrivalUptime: 100.12, bufferDuration: 0.1, pausedTotal: 0), 0)
    }

    /// Review finding P2 (second pass): a callback still in flight from
    /// the engine being torn down must not close the gap — if it did, the
    /// new engine's first buffer would get no silence and the mic track
    /// would end up shorter than the system track.
    func testLateCallbackFromTheOldEngineDoesNotConsumeTheGap() {
        var tracker = MicRestartGapTracker()
        tracker.markBuffer(uptime: 100, pausedTotal: 0)
        tracker.open(nextEpoch: 1)
        XCTAssertFalse(tracker.isCurrent(epoch: 0), "old engine's tap is stale")
        XCTAssertTrue(tracker.isOpen, "gap stays open for the new engine")
        XCTAssertTrue(tracker.isCurrent(epoch: 1))
        let silence = tracker.close(arrivalUptime: 103.1, bufferDuration: 0.1, pausedTotal: 0)
        XCTAssertEqual(silence, 3, accuracy: 0.0001)
    }

    func testRetriedRestartMovesToTheNewestEngine() {
        var tracker = MicRestartGapTracker()
        tracker.markBuffer(uptime: 100, pausedTotal: 0)
        tracker.open(nextEpoch: 1) // restart attempt 1 fails
        tracker.open(nextEpoch: 2) // retry
        XCTAssertFalse(tracker.isCurrent(epoch: 1))
        XCTAssertTrue(tracker.isCurrent(epoch: 2))
        XCTAssertEqual(tracker.gapStartUptime, 100)
    }

    /// Review finding P2 (fourth pass): an unplugged selected mic used to
    /// be retried forever, leaving the rest of the note silent.
    func testRestartFallsBackToTheDefaultInputWhenTheSelectedMicIsGone() {
        XCTAssertEqual(MicRestartDevicePolicy.devicesToTry(selected: "usb-mic-uid"), ["usb-mic-uid", nil])
        XCTAssertEqual(MicRestartDevicePolicy.devicesToTry(selected: nil), [nil])
    }

    /// Review finding P2 (fifth pass): a 10-minute cap shifted everything
    /// after a 15-minute outage five minutes early. Long gaps are filled
    /// in full; only an absurd clock delta is capped.
    func testLongOutageIsFilledInFull() {
        var tracker = MicRestartGapTracker()
        tracker.markBuffer(uptime: 0, pausedTotal: 0)
        tracker.open(nextEpoch: 1)
        let silence = tracker.close(arrivalUptime: 15 * 60 + 0.1, bufferDuration: 0.1, pausedTotal: 0)
        XCTAssertEqual(silence, 15 * 60, accuracy: 0.0001)
        var absurd = MicRestartGapTracker()
        absurd.markBuffer(uptime: 0, pausedTotal: 0)
        absurd.open(nextEpoch: 1)
        XCTAssertEqual(absurd.close(arrivalUptime: 10 * 3600, bufferDuration: 0.1, pausedTotal: 0), MicRestartGapTracker.maximumGap)
    }

    /// Review finding (seventh pass): a fill that fails part-way must not
    /// close the gap — the unwritten remainder is retried with the next
    /// buffer, or the rest of the note shifts against the system track.
    func testPartialFillReopensTheUnwrittenRemainder() {
        var tracker = MicRestartGapTracker()
        tracker.markBuffer(uptime: 100, pausedTotal: 0)
        tracker.open(nextEpoch: 1)
        let first = tracker.close(arrivalUptime: 110.1, bufferDuration: 0.1, pausedTotal: 0)
        XCTAssertEqual(first, 10, accuracy: 0.0001)
        tracker.reopenAfterPartialFill(written: 4) // 6 s still missing
        XCTAssertTrue(tracker.isOpen)
        // Next buffer 0.1 s later: the remainder plus the dropped buffer.
        let retry = tracker.close(arrivalUptime: 110.2, bufferDuration: 0.1, pausedTotal: 0)
        XCTAssertEqual(retry, 6.1, accuracy: 0.0001)
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
        XCTAssertEqual(writer.appendSilence(seconds: 2), 2, accuracy: 0.001) // restart gap
        try writer.append(buffer)                 // 0.5 s after the restart
        _ = try await writer.finish()

        let file = try AVAudioFile(forReading: url)
        let seconds = Double(file.length) / file.fileFormat.sampleRate
        XCTAssertEqual(seconds, 3.0, accuracy: 0.1)
    }

    /// The gap fill runs on the tap thread, so it has to be cheap even
    /// for a long gap (a minute of silence must not stall capture).
    func testSilenceFillForAMinuteIsFast() throws {
        let url = FileManager.default.temporaryDirectory
            .appending(path: "mic-gap-fill-\(UUID()).m4a")
        defer { try? FileManager.default.removeItem(at: url) }
        let writer = try AudioAssetWriter(outputURL: url, sampleRate: 48_000, channelCount: 1)
        let format = AVAudioFormat(standardFormatWithSampleRate: 48_000, channels: 1)!
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 4_800)!
        buffer.frameLength = 4_800
        try writer.append(buffer)
        let started = Date()
        writer.appendSilence(seconds: 60)
        let elapsed = Date().timeIntervalSince(started)
        print("appendSilence(60 s) took \(String(format: "%.3f", elapsed)) s")
        XCTAssertLessThan(elapsed, 1.5)
    }

    func testAppendSilenceBeforeAnyAudioIsANoOp() throws {
        let url = FileManager.default.temporaryDirectory
            .appending(path: "mic-gap-fill-\(UUID()).m4a")
        defer { try? FileManager.default.removeItem(at: url) }
        let writer = try AudioAssetWriter(outputURL: url, sampleRate: 48_000, channelCount: 1)
        _ = writer.appendSilence(seconds: 1)
        XCTAssertEqual(writer.writeHealth.framesWritten, 0)
    }
}
