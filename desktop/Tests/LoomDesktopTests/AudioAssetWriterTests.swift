import AVFoundation
import XCTest
@testable import LoomDesktopApp

/// Locks the input sanitization in AudioAssetWriter that prevents
/// AVAssetWriterInput from raising an uncatchable ObjC NSException
/// when handed degenerate sample-rate / channel-count values from a
/// not-yet-started AVAudioEngine.
final class AudioAssetWriterTests: XCTestCase {
    func testInitDoesNotThrowOnDegenerateChannelCount() throws {
        // Reproduces the crash Ian saw on first launch: voice
        // processing was enabled but the engine hadn't started, so
        // inputNode.outputFormat(forBus: 0).channelCount returned 0.
        // Passing 0 channels into AVAssetWriterInput.init crashed
        // the process. With sanitization, the writer should
        // construct cleanly and produce a valid m4a file.
        let url = FileManager.default.temporaryDirectory
            .appending(path: "audio-asset-writer-test-\(UUID()).m4a")
        defer { try? FileManager.default.removeItem(at: url) }

        XCTAssertNoThrow(
            try AudioAssetWriter(outputURL: url, sampleRate: 48_000, channelCount: 0)
        )
    }

    func testInitDoesNotThrowOnZeroSampleRate() throws {
        let url = FileManager.default.temporaryDirectory
            .appending(path: "audio-asset-writer-test-\(UUID()).m4a")
        defer { try? FileManager.default.removeItem(at: url) }

        XCTAssertNoThrow(
            try AudioAssetWriter(outputURL: url, sampleRate: 0, channelCount: 1)
        )
    }

    func testInitClampsAbsurdChannelCountToMono() throws {
        // 96-channel AAC isn't valid; fall back to mono.
        let url = FileManager.default.temporaryDirectory
            .appending(path: "audio-asset-writer-test-\(UUID()).m4a")
        defer { try? FileManager.default.removeItem(at: url) }

        XCTAssertNoThrow(
            try AudioAssetWriter(outputURL: url, sampleRate: 48_000, channelCount: 96)
        )
    }

    func testInitSnapsUnusualSampleRateToSupportedValue() throws {
        // 50_000 isn't an AAC-supported rate; should snap to 48000.
        let url = FileManager.default.temporaryDirectory
            .appending(path: "audio-asset-writer-test-\(UUID()).m4a")
        defer { try? FileManager.default.removeItem(at: url) }

        XCTAssertNoThrow(
            try AudioAssetWriter(outputURL: url, sampleRate: 50_000, channelCount: 1)
        )
    }

    func testAppendConvertsChangedInputSampleRate() async throws {
        let url = FileManager.default.temporaryDirectory
            .appending(path: "audio-asset-writer-test-\(UUID()).m4a")
        defer { try? FileManager.default.removeItem(at: url) }

        let writer = try AudioAssetWriter(outputURL: url, sampleRate: 48_000, channelCount: 1)
        try writer.start()
        try writer.append(Self.makeSilentBuffer(sampleRate: 48_000, frames: 24_000))
        try writer.append(Self.makeSilentBuffer(sampleRate: 44_100, frames: 22_050))
        _ = try await writer.finish()

        let file = try AVAudioFile(forReading: url)
        XCTAssertGreaterThan(file.length, 42_000)
    }

    /// Regression for the 2026-09-22 lost-mic meeting: a Bluetooth
    /// headset in call mode hands the engine 24 kHz (or 16 kHz / 8 kHz)
    /// mono. The writer used to open an AAC file at that native rate
    /// with a fixed 128 kbps bitrate, which the AAC encoder rejects
    /// (AudioCodecInitialize failed / setBitRate error 560226676) —
    /// every append threw, the tap swallowed it, and the meeting's mic
    /// track came out as a 557-byte header with zero audio packets.
    func testWritesAudioForBluetoothCallSampleRates() async throws {
        for sampleRate in [8_000.0, 16_000, 24_000, 32_000] {
            let url = FileManager.default.temporaryDirectory
                .appending(path: "audio-asset-writer-test-\(UUID()).m4a")
            defer { try? FileManager.default.removeItem(at: url) }

            let writer = try AudioAssetWriter(
                outputURL: url,
                sampleRate: sampleRate,
                channelCount: 1
            )
            try writer.start()
            let oneSecond = AVAudioFrameCount(sampleRate)
            for _ in 0..<3 {
                try writer.append(Self.makeSilentBuffer(sampleRate: sampleRate, frames: oneSecond))
            }
            _ = try await writer.finish()

            let file = try AVAudioFile(forReading: url)
            let seconds = Double(file.length) / file.fileFormat.sampleRate
            XCTAssertGreaterThan(
                seconds, 2.5,
                "\(Int(sampleRate)) Hz mono input produced \(seconds)s of audio"
            )
        }
    }

    /// A mid-call switch from a 48 kHz USB mic to a 24 kHz headset must
    /// keep writing into the same file rather than failing.
    func testAppendConvertsDropToBluetoothSampleRate() async throws {
        let url = FileManager.default.temporaryDirectory
            .appending(path: "audio-asset-writer-test-\(UUID()).m4a")
        defer { try? FileManager.default.removeItem(at: url) }

        let writer = try AudioAssetWriter(outputURL: url, sampleRate: 48_000, channelCount: 1)
        try writer.start()
        try writer.append(Self.makeSilentBuffer(sampleRate: 48_000, frames: 48_000))
        try writer.append(Self.makeSilentBuffer(sampleRate: 24_000, frames: 24_000))
        _ = try await writer.finish()

        let file = try AVAudioFile(forReading: url)
        let seconds = Double(file.length) / file.fileFormat.sampleRate
        XCTAssertGreaterThan(seconds, 1.8)
    }

    func testWriteHealthCountsWrittenFrames() async throws {
        let url = FileManager.default.temporaryDirectory
            .appending(path: "audio-asset-writer-test-\(UUID()).m4a")
        defer { try? FileManager.default.removeItem(at: url) }

        let writer = try AudioAssetWriter(outputURL: url, sampleRate: 48_000, channelCount: 1)
        try writer.append(Self.makeSilentBuffer(sampleRate: 48_000, frames: 4_096))

        let health = writer.writeHealth
        XCTAssertEqual(health.framesWritten, 4_096)
        XCTAssertEqual(health.failedAppends, 0)
        XCTAssertFalse(health.isFailing)
        _ = try await writer.finish()
    }

    /// Every append failing must be visible to the recorder — this is
    /// the signal that was missing when a meeting's mic track was lost.
    func testWriteHealthReportsFailingAppends() throws {
        let url = FileManager.default.temporaryDirectory
            .appending(path: "missing-dir-\(UUID())/audio.m4a")
        let writer = try AudioAssetWriter(outputURL: url, sampleRate: 48_000, channelCount: 1)
        let buffer = try Self.makeSilentBuffer(sampleRate: 48_000, frames: 4_096)

        for _ in 0..<(AudioAssetWriter.WriteHealth.failingThreshold - 1) {
            XCTAssertThrowsError(try writer.append(buffer))
        }
        XCTAssertFalse(writer.writeHealth.isFailing, "one-off failures should not alert")

        XCTAssertThrowsError(try writer.append(buffer))
        let health = writer.writeHealth
        XCTAssertTrue(health.isFailing)
        XCTAssertEqual(health.framesWritten, 0)
        XCTAssertNotNil(health.lastError)
    }

    func testRecorderAlertsOnFailingTrackWrites() throws {
        let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
        let source = try String(
            contentsOf: root.appending(path: "Sources/LoomDesktopApp/UI/RecorderViewModel.swift")
        )
        XCTAssertTrue(
            source.contains("checkAudioTrackWriteHealth()\n"),
            "The recording tick must check whether tracks are actually being saved."
        )
        XCTAssertTrue(
            source.contains("audioNoteRecorder.failingTracks()"),
            "The write-health check must read the recorder's per-track health."
        )
        XCTAssertTrue(
            source.contains("postAudioTrackFailureNotification(trackName: trackName)"),
            "A failing track must raise a system notification, not just a log line."
        )
    }

    private static func makeSilentBuffer(
        sampleRate: Double,
        frames: AVAudioFrameCount
    ) throws -> AVAudioPCMBuffer {
        let format = AVAudioFormat(
            commonFormat: .pcmFormatFloat32,
            sampleRate: sampleRate,
            channels: 1,
            interleaved: false
        )
        guard let format,
              let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames)
        else {
            throw TestAudioBufferError.couldNotCreateBuffer
        }
        buffer.frameLength = frames
        return buffer
    }
}

private enum TestAudioBufferError: Error {
    case couldNotCreateBuffer
}
