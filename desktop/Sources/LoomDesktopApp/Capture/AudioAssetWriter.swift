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

        // Sanitize. The caller usually passes
        // `inputNode.outputFormat(forBus: 0)` values from
        // AVAudioEngine, which can be degenerate before the engine
        // has started — sample rate or channel count may be 0.
        // Passing those to AVAssetWriterInput raises an ObjC
        // NSException ("-[AVAssetWriterInput init...]") which Swift
        // can't catch, causing an abort. Clamp to known-good AAC
        // values so we always get a valid encoder.
        //
        // Behaviorally, AVFoundation transcodes from any input PCM
        // format to the requested AAC settings, so hardcoding
        // doesn't constrain the source.
        let aacSampleRate = Self.aacSafeSampleRate(sampleRate)
        let aacChannelCount = Self.aacSafeChannelCount(channelCount)

        input = AVAssetWriterInput(
            mediaType: .audio,
            outputSettings: [
                AVFormatIDKey: kAudioFormatMPEG4AAC,
                AVSampleRateKey: aacSampleRate,
                AVNumberOfChannelsKey: aacChannelCount,
                AVEncoderBitRateKey: 128_000
            ]
        )
        input.expectsMediaDataInRealTime = true
        guard writer.canAdd(input) else {
            throw AudioAssetWriterError.cannotAddInput
        }
        writer.add(input)
    }

    /// AAC accepts a fixed set of sample rates: 8000, 11025, 12000,
    /// 16000, 22050, 24000, 32000, 44100, 48000, 64000, 88200, 96000.
    /// Snap any caller-supplied rate to the nearest one in that set,
    /// defaulting to 48000 if input is non-positive.
    private static func aacSafeSampleRate(_ rate: Double) -> Double {
        let supported: [Double] = [
            8000, 11025, 12000, 16000, 22050, 24000,
            32000, 44100, 48000, 64000, 88200, 96000
        ]
        guard rate.isFinite, rate > 0 else { return 48_000 }
        // Pick the closest supported rate.
        return supported.min(by: { abs($0 - rate) < abs($1 - rate) }) ?? 48_000
    }

    /// AAC supports 1..8 channels. Anything ≤ 0 or > 8 falls back
    /// to 1 (mono) — which is what voice-processing-enabled mic
    /// capture produces anyway.
    private static func aacSafeChannelCount(_ count: Int) -> Int {
        guard count >= 1, count <= 8 else { return 1 }
        return count
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
