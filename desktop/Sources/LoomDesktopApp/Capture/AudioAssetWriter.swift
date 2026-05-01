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

        let writer = AssetWriterBox(writer)
        let outputURL = outputURL
        return try await withCheckedThrowingContinuation { continuation in
            let box = ContinuationBox(continuation)
            writer.finishWriting {
                if let error = writer.error {
                    box.resume(throwing: error)
                    return
                }
                box.resume(returning: outputURL)
            }
            Task {
                try? await Task.sleep(for: .seconds(5))
                box.resume(throwing: AudioAssetWriterError.finishTimedOut)
            }
        }
    }
}

enum AudioAssetWriterError: Error {
    case cannotAddInput
    case couldNotStart
    case appendFailed
    case finishTimedOut
}

private final class ContinuationBox<Value: Sendable>: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<Value, Error>?

    init(_ continuation: CheckedContinuation<Value, Error>) {
        self.continuation = continuation
    }

    func resume(returning value: Value) {
        let continuation = take()
        continuation?.resume(returning: value)
    }

    func resume(throwing error: Error) {
        let continuation = take()
        continuation?.resume(throwing: error)
    }

    private func take() -> CheckedContinuation<Value, Error>? {
        lock.lock()
        defer { lock.unlock() }
        let continuation = continuation
        self.continuation = nil
        return continuation
    }
}

private final class AssetWriterBox: @unchecked Sendable {
    private let writer: AVAssetWriter

    init(_ writer: AVAssetWriter) {
        self.writer = writer
    }

    var error: Error? {
        writer.error
    }

    func finishWriting(_ completionHandler: @escaping @Sendable () -> Void) {
        writer.finishWriting(completionHandler: completionHandler)
    }
}
