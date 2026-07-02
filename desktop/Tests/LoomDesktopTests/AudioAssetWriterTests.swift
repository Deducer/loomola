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
