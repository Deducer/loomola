import AVFoundation
import XCTest
@testable import LoomDesktopApp

/// Mic survives a device change mid-note: the restart gap is filled with
/// silence so the mic track stays aligned with the system track.
final class MicRestartGapTrackerTests: XCTestCase {
    func testGapIsTimeBetweenLastAudioAndNewAudio() {
        var tracker = MicRestartGapTracker()
        tracker.open(lastBufferUptime: 100, pausedTotal: 0)
        XCTAssertTrue(tracker.isOpen)
        // New buffer (0.1 s long) arrives at 103.6 → its audio began at 103.5.
        let silence = tracker.close(arrivalUptime: 103.6, bufferDuration: 0.1, pausedTotal: 0)
        XCTAssertEqual(silence, 3.5, accuracy: 0.0001)
        XCTAssertFalse(tracker.isOpen)
    }

    func testPausedTimeDuringTheGapIsNotFilled() {
        var tracker = MicRestartGapTracker()
        tracker.open(lastBufferUptime: 100, pausedTotal: 5)
        // 20 s of the gap was a user pause (paused total 5 → 25).
        let silence = tracker.close(arrivalUptime: 130.1, bufferDuration: 0.1, pausedTotal: 25)
        XCTAssertEqual(silence, 10, accuracy: 0.0001)
    }

    func testRetriedRestartKeepsTheOriginalGapStart() {
        var tracker = MicRestartGapTracker()
        tracker.open(lastBufferUptime: 100, pausedTotal: 0)
        tracker.open(lastBufferUptime: 104, pausedTotal: 0)
        XCTAssertEqual(tracker.gapStartUptime, 100)
    }

    func testJitterAndClosedGapsInsertNothing() {
        var tracker = MicRestartGapTracker()
        XCTAssertEqual(tracker.close(arrivalUptime: 10, bufferDuration: 0.1, pausedTotal: 0), 0)
        tracker.open(lastBufferUptime: 100, pausedTotal: 0)
        XCTAssertEqual(tracker.close(arrivalUptime: 100.12, bufferDuration: 0.1, pausedTotal: 0), 0)
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
