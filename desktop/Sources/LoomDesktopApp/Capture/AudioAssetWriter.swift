import AVFoundation
import CoreMedia
import Foundation

/// Writes microphone or system-audio capture to an AAC-in-M4A file.
///
/// Implementation note: this used to wrap `AVAssetWriter` +
/// `AVAssetWriterInput`. On macOS 26.4.1 the AAC variant of
/// `-[AVAssetWriterInput initWithMediaType:outputSettings:sourceFormatHint:]`
/// throws an uncatchable `NSInvalidArgumentException` from inside
/// AVFCore, even with valid AAC settings — Swift can't catch it,
/// so the process aborts. We sidestep the entire AVF input
/// pipeline by writing through `AVAudioFile`, which uses
/// `ExtAudioFile` (Audio Toolbox) under the hood. Same AAC m4a
/// output, completely different orchestration layer that doesn't
/// have the bug.
final class AudioAssetWriter: @unchecked Sendable {
    private let outputURL: URL
    private let settings: [String: Any]
    private var audioFile: AVAudioFile?
    private var converter: AVAudioConverter?
    private var converterInputSignature: AudioFormatSignature?
    private var converterOutputSignature: AudioFormatSignature?
    private var finished = false
    private let writeLock = NSLock()

    init(outputURL: URL, sampleRate: Double = 48_000, channelCount: Int = 1) throws {
        self.outputURL = outputURL
        self.settings = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: Self.aacSafeSampleRate(sampleRate),
            AVNumberOfChannelsKey: Self.aacSafeChannelCount(channelCount),
            AVEncoderBitRateKey: 128_000
        ]
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
        return supported.min(by: { abs($0 - rate) < abs($1 - rate) }) ?? 48_000
    }

    /// AAC supports 1..8 channels. Anything ≤ 0 or > 8 falls back to 1.
    private static func aacSafeChannelCount(_ count: Int) -> Int {
        guard count >= 1, count <= 8 else { return 1 }
        return count
    }

    func start() throws {
        // No-op. The AVAudioFile is created lazily on the first
        // append, when we first see the actual incoming PCM format.
        // Init can't fail here because we don't open the file yet.
    }

    /// Mic flow: pass the original PCM buffer from the engine tap.
    /// Avoids the CMSampleBuffer round-trip (the tap already gives
    /// us a PCM buffer; AVAudioFile wants a PCM buffer).
    func append(_ pcmBuffer: AVAudioPCMBuffer) throws {
        try writePCM(pcmBuffer)
    }

    /// System-audio flow: SCStream hands us CMSampleBuffer, so we
    /// have to convert to AVAudioPCMBuffer first.
    func append(_ sampleBuffer: CMSampleBuffer) throws {
        guard sampleBuffer.isValid else { return }
        guard let pcmBuffer = Self.makePCMBuffer(from: sampleBuffer) else { return }
        try writePCM(pcmBuffer)
    }

    func finish() async throws -> URL {
        closeFile()
        return outputURL
    }

    private func closeFile() {
        writeLock.lock()
        defer { writeLock.unlock() }
        finished = true
        // Releasing the AVAudioFile flushes and closes the file.
        audioFile = nil
    }

    private func writePCM(_ pcmBuffer: AVAudioPCMBuffer) throws {
        writeLock.lock()
        defer { writeLock.unlock() }
        if finished { return }
        let file = try ensureFileLocked(inputFormat: pcmBuffer.format)
        let writableBuffer = Self.formatsMatch(pcmBuffer.format, file.processingFormat)
            ? pcmBuffer
            : try convertedBufferLocked(pcmBuffer, to: file.processingFormat)
        try file.write(from: writableBuffer)
    }

    private func ensureFileLocked(inputFormat: AVAudioFormat) throws -> AVAudioFile {
        if let audioFile { return audioFile }
        // `settings` drives the OUTPUT (compressed AAC m4a) format.
        // `commonFormat` + `interleaved` describe the INPUT PCM
        // buffers we'll be writing — AVAudioFile transcodes on the
        // fly via an internal AVAudioConverter.
        let file = try AVAudioFile(
            forWriting: outputURL,
            settings: settings,
            commonFormat: inputFormat.commonFormat,
            interleaved: inputFormat.isInterleaved
        )
        audioFile = file
        return file
    }

    private func convertedBufferLocked(
        _ inputBuffer: AVAudioPCMBuffer,
        to outputFormat: AVAudioFormat
    ) throws -> AVAudioPCMBuffer {
        let inputSignature = AudioFormatSignature(inputBuffer.format)
        let outputSignature = AudioFormatSignature(outputFormat)
        if converter == nil ||
            converterInputSignature != inputSignature ||
            converterOutputSignature != outputSignature {
            converter = AVAudioConverter(from: inputBuffer.format, to: outputFormat)
            converterInputSignature = inputSignature
            converterOutputSignature = outputSignature
        }
        guard let converter else {
            throw AudioAssetWriterError.conversionUnavailable
        }

        let sampleRateRatio = outputFormat.sampleRate / max(inputBuffer.format.sampleRate, 1)
        let capacity = AVAudioFrameCount(
            max(1, ceil(Double(inputBuffer.frameLength) * sampleRateRatio) + 32)
        )
        guard let outputBuffer = AVAudioPCMBuffer(
            pcmFormat: outputFormat,
            frameCapacity: capacity
        ) else {
            throw AudioAssetWriterError.conversionUnavailable
        }

        var didProvideInput = false
        var conversionError: NSError?
        let status = converter.convert(to: outputBuffer, error: &conversionError) { _, outStatus in
            if didProvideInput {
                outStatus.pointee = .noDataNow
                return nil
            }
            didProvideInput = true
            outStatus.pointee = .haveData
            return inputBuffer
        }

        if status == .error {
            throw conversionError ?? AudioAssetWriterError.conversionFailed
        }
        return outputBuffer
    }

    private static func formatsMatch(
        _ lhs: AVAudioFormat,
        _ rhs: AVAudioFormat
    ) -> Bool {
        lhs.sampleRate == rhs.sampleRate &&
            lhs.channelCount == rhs.channelCount &&
            lhs.commonFormat == rhs.commonFormat &&
            lhs.isInterleaved == rhs.isInterleaved
    }

    private static func makePCMBuffer(from sampleBuffer: CMSampleBuffer) -> AVAudioPCMBuffer? {
        guard let formatDescription = CMSampleBufferGetFormatDescription(sampleBuffer),
              let asbdPtr = CMAudioFormatDescriptionGetStreamBasicDescription(formatDescription)
        else { return nil }
        let frameCount = CMSampleBufferGetNumSamples(sampleBuffer)
        guard frameCount > 0 else { return nil }
        guard let format = AVAudioFormat(streamDescription: asbdPtr) else { return nil }
        guard let pcmBuffer = AVAudioPCMBuffer(
            pcmFormat: format,
            frameCapacity: AVAudioFrameCount(frameCount)
        ) else { return nil }
        pcmBuffer.frameLength = AVAudioFrameCount(frameCount)
        let abl = pcmBuffer.mutableAudioBufferList
        let status = CMSampleBufferCopyPCMDataIntoAudioBufferList(
            sampleBuffer,
            at: 0,
            frameCount: Int32(frameCount),
            into: abl
        )
        guard status == noErr else { return nil }
        return pcmBuffer
    }
}

private struct AudioFormatSignature: Equatable {
    let sampleRate: Double
    let channelCount: AVAudioChannelCount
    let commonFormat: AVAudioCommonFormat
    let isInterleaved: Bool

    init(_ format: AVAudioFormat) {
        sampleRate = format.sampleRate
        channelCount = format.channelCount
        commonFormat = format.commonFormat
        isInterleaved = format.isInterleaved
    }
}

private enum AudioAssetWriterError: LocalizedError {
    case conversionUnavailable
    case conversionFailed

    var errorDescription: String? {
        switch self {
        case .conversionUnavailable:
            return "Could not convert changed audio format for writing."
        case .conversionFailed:
            return "Audio format conversion failed."
        }
    }
}
