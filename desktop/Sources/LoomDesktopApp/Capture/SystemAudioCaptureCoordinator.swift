import AVFoundation
import CoreMedia
import Foundation
import ScreenCaptureKit

@available(macOS 14.0, *)
final class SystemAudioCaptureCoordinator: NSObject, SCStreamOutput, SCStreamDelegate, @unchecked Sendable {
    var onLevel: ((Double) -> Void)?

    private var stream: SCStream?
    private var writer: AudioAssetWriter?
    private let sampleQueue = DispatchQueue(label: "cloud.dissonance.loom.desktop.system-audio-samples")
    /// Pause/resume PTS-adjustment state. Mirrors the pattern in
    /// MicrophoneCaptureCoordinator — see Capture/PauseAdjuster.swift.
    private var pauseAdjuster = PauseAdjuster()
    private let pauseLock = NSLock()
    private var lastSeenRawPTS: CMTime = .invalid

    func start(outputURL: URL) async throws {
        let content = try await SCShareableContent.current
        guard let display = content.displays.first else {
            throw SystemAudioCaptureCoordinatorError.noDisplays
        }

        let config = SCStreamConfiguration()
        config.width = 2
        config.height = 2
        config.minimumFrameInterval = CMTime(value: 1, timescale: 1)
        config.queueDepth = 3
        config.showsCursor = false
        config.capturesAudio = true
        config.excludesCurrentProcessAudio = false

        let filter = SCContentFilter(display: display, excludingWindows: [])
        let stream = SCStream(filter: filter, configuration: config, delegate: self)
        try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: sampleQueue)

        let writer = try AudioAssetWriter(outputURL: outputURL, channelCount: 2)
        try writer.start()
        self.writer = writer
        self.stream = stream
        try await stream.startCapture()
    }

    func stop() async throws -> URL {
        guard let stream, let writer else {
            throw SystemAudioCaptureCoordinatorError.notRecording
        }
        try await stream.stopCapture()
        self.stream = nil
        self.writer = nil
        return try await writer.finish()
    }

    func stream(
        _ stream: SCStream,
        didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
        of type: SCStreamOutputType
    ) {
        guard type == .audio else { return }

        let rawPTS = sampleBuffer.presentationTimeStamp
        pauseLock.lock()
        lastSeenRawPTS = rawPTS
        let adjusted = pauseAdjuster.adjust(rawPTS: rawPTS)
        pauseLock.unlock()

        // Always emit level so UI feedback continues while paused.
        if let level = AudioLevelSampler.linearLevel(from: sampleBuffer) {
            onLevel?(level)
        }

        // Paused → drop the sample.
        guard let adjusted else { return }

        // Rewrite the sample buffer's PTS to the adjusted value
        // before appending. CMSampleBuffer is immutable on its
        // timing array, but we can build a new CMSampleBuffer
        // wrapping the same data with new timing.
        if let rewritten = rewritePTS(of: sampleBuffer, to: adjusted) {
            try? writer?.append(rewritten)
        }
    }

    func pause() {
        pauseLock.lock()
        defer { pauseLock.unlock() }
        pauseAdjuster.pause(atRawPTS: lastSeenRawPTS)
    }

    func resume() {
        pauseLock.lock()
        defer { pauseLock.unlock() }
        pauseAdjuster.resume(atRawPTS: lastSeenRawPTS)
    }

    var isPaused: Bool {
        pauseLock.lock()
        defer { pauseLock.unlock() }
        return pauseAdjuster.isPaused
    }
}

/// Rewrite the presentation timestamp of an existing
/// CMSampleBuffer to a new value. Returns a fresh sample buffer
/// wrapping the same data + format. Used to subtract paused
/// duration from system-audio samples coming out of SCStream.
private func rewritePTS(of original: CMSampleBuffer, to newPTS: CMTime) -> CMSampleBuffer? {
    var count: CMItemCount = 0
    CMSampleBufferGetSampleTimingInfoArray(
        original,
        entryCount: 0,
        arrayToFill: nil,
        entriesNeededOut: &count
    )
    guard count > 0 else { return nil }
    var timings = [CMSampleTimingInfo](
        repeating: CMSampleTimingInfo(),
        count: count
    )
    CMSampleBufferGetSampleTimingInfoArray(
        original,
        entryCount: count,
        arrayToFill: &timings,
        entriesNeededOut: nil
    )

    // Shift the first entry's PTS to newPTS; preserve the rest's
    // relative offsets. For audio there's typically one timing
    // entry per buffer so this is a single-element rewrite.
    let originalFirstPTS = timings[0].presentationTimeStamp
    let shift = CMTimeSubtract(newPTS, originalFirstPTS)
    for i in 0..<count {
        timings[i].presentationTimeStamp = CMTimeAdd(
            timings[i].presentationTimeStamp,
            shift
        )
    }

    var rewritten: CMSampleBuffer?
    let status = CMSampleBufferCreateCopyWithNewTiming(
        allocator: kCFAllocatorDefault,
        sampleBuffer: original,
        sampleTimingEntryCount: count,
        sampleTimingArray: &timings,
        sampleBufferOut: &rewritten
    )
    return status == noErr ? rewritten : nil
}

@available(macOS 14.0, *)
enum SystemAudioCaptureCoordinatorError: LocalizedError {
    case noDisplays
    case notRecording

    var errorDescription: String? {
        switch self {
        case .noDisplays:
            return "No display was available for system audio capture."
        case .notRecording:
            return "There is no active system audio recording to stop."
        }
    }
}
