import AVFoundation
import Foundation

final class AudioAssetWriter: @unchecked Sendable {
    private let outputURL: URL
    private let writer: AVAssetWriter
    private let input: AVAssetWriterInput
    private var didStartSession = false
    private var finished = false

    init(outputURL: URL, sampleRate: Double = 48_000, channelCount: Int = 1) throws {
        self.outputURL = outputURL
        writer = try AVAssetWriter(outputURL: outputURL, fileType: .m4a)
        input = AVAssetWriterInput(
            mediaType: .audio,
            outputSettings: [
                AVFormatIDKey: kAudioFormatMPEG4AAC,
                AVSampleRateKey: sampleRate,
                AVNumberOfChannelsKey: channelCount,
                AVEncoderBitRateKey: 128_000
            ]
        )
        input.expectsMediaDataInRealTime = true
        guard writer.canAdd(input) else {
            throw AudioAssetWriterError.cannotAddInput
        }
        writer.add(input)
    }

    func start() throws {
        guard writer.startWriting() else {
            throw writer.error ?? AudioAssetWriterError.couldNotStart
        }
    }

    func append(_ sampleBuffer: CMSampleBuffer) throws {
        guard !finished else { return }
        guard sampleBuffer.isValid else { return }
        if !didStartSession {
            writer.startSession(atSourceTime: sampleBuffer.presentationTimeStamp)
            didStartSession = true
        }
        guard input.isReadyForMoreMediaData else { return }
        guard input.append(sampleBuffer) else {
            throw writer.error ?? AudioAssetWriterError.appendFailed
        }
    }

    func finish() async throws -> URL {
        guard !finished else { return outputURL }
        finished = true
        input.markAsFinished()

        return try await withCheckedThrowingContinuation { continuation in
            writer.finishWriting {
                if let error = self.writer.error {
                    continuation.resume(throwing: error)
                    return
                }
                continuation.resume(returning: self.outputURL)
            }
        }
    }
}

enum AudioAssetWriterError: Error {
    case cannotAddInput
    case couldNotStart
    case appendFailed
}
