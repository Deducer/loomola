import AppKit
import Foundation
import CoreMedia
import ScreenCaptureKit

@available(macOS 14.0, *)
@MainActor
final class ScreenCaptureCoordinator: NSObject, SCStreamOutput, SCStreamDelegate {
    private(set) var isCapturing = false
    private(set) var frameCount = 0
    private var stream: SCStream?
    private var recordingOutput: AnyObject?
    private var recordingURL: URL?
    private var recordingStartDate: Date?
    private var recordingFinishContinuation: CheckedContinuation<RecordedScreenFile, Error>?
    private var recordingFinishFallbackTask: Task<Void, Never>?
    private let sampleQueue = DispatchQueue(label: "cloud.dissonance.loom.desktop.screen-samples")

    // Compositor sample-buffer plumbing. Per-frame screen pixel buffers
    // are published behind an NSLock for the future CompositeRecorder to
    // sample at draw time. nonisolated(unsafe) because the lock guards
    // cross-thread access — the SCStreamOutput callback is nonisolated
    // and the future compositor reader will also be off the main actor.
    private let latestScreenLock = NSLock()
    nonisolated(unsafe) private var latestScreenPixelBufferStorage: CVPixelBuffer?
    private(set) var capturedDisplaySizePixels: CGSize = .zero

    /// Compositor hook. When set, every valid screen `CMSampleBuffer`
    /// is forwarded with its original PTS — the compositor uses this
    /// as its render-driver pulse and source of truth for timing.
    /// Called on the SCStreamOutput sample queue (not main).
    nonisolated(unsafe) var onScreenSampleBuffer: ((CMSampleBuffer) -> Void)?

    deinit {
        recordingFinishFallbackTask?.cancel()
        recordingFinishContinuation?.resume(
            throwing: ScreenCaptureCoordinatorError.recordingStoppedBeforeFileWasReady
        )
    }

    func requestShareableContent() async throws {
        _ = try await SCShareableContent.current
    }

    func startFirstDisplayCapture() async throws -> DisplaySource {
        let content = try await SCShareableContent.current
        guard let display = content.displays.first else {
            throw ScreenCaptureCoordinatorError.noDisplays
        }

        // SCDisplay.width/height are in POINTS (logical resolution) —
        // for a 4K Retina display this returns 1920x1080, not the
        // native 3840x2160. SCStream then captures at that point
        // count, which is half-resolution. The compositor's output
        // frame size is in pixels (NSScreen.frame * backingScaleFactor),
        // so without the multiplier here, the captured screen buffer
        // ends up smaller than the output frame and gets anchored at
        // the bottom-left of the y-up canvas, leaving the top + right
        // black. Multiply by the matching display's backing scale
        // factor so SCStream captures at native pixels.
        let scale = Self.backingScaleFactor(for: display.displayID)
        let pixelWidth = Int(Double(display.width) * scale)
        let pixelHeight = Int(Double(display.height) * scale)

        let config = SCStreamConfiguration()
        config.width = pixelWidth
        config.height = pixelHeight
        config.minimumFrameInterval = CMTime(value: 1, timescale: 30)
        config.queueDepth = 5
        config.showsCursor = true
        config.capturesAudio = true
        config.excludesCurrentProcessAudio = false

        let filter = SCContentFilter(display: display, excludingWindows: [])
        let stream = SCStream(filter: filter, configuration: config, delegate: self)
        try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: sampleQueue)
        try await stream.startCapture()

        frameCount = 0
        self.stream = stream
        isCapturing = true
        capturedDisplaySizePixels = CGSize(width: pixelWidth, height: pixelHeight)
        return DisplaySource(
            id: display.displayID,
            name: "Display \(display.displayID)",
            width: pixelWidth,
            height: pixelHeight
        )
    }

    /// Look up the AppKit `NSScreen` that corresponds to the given
    /// CoreGraphics display ID and return its backingScaleFactor.
    /// Used to upgrade SCStream's point-based capture dimensions to
    /// native pixels. Falls back to 2.0 (the most common Retina
    /// scale) if no matching screen is found — better than 1.0
    /// because virtually every Mac mini / MacBook ships Retina now.
    private static func backingScaleFactor(for displayID: CGDirectDisplayID) -> Double {
        let key = NSDeviceDescriptionKey("NSScreenNumber")
        for screen in NSScreen.screens {
            if let id = screen.deviceDescription[key] as? CGDirectDisplayID,
               id == displayID
            {
                return Double(screen.backingScaleFactor)
            }
        }
        return Double(NSScreen.main?.backingScaleFactor ?? 2.0)
    }

    func startFirstDisplayRecording(outputURL: URL) async throws -> DisplaySource {
        guard #available(macOS 15.0, *) else {
            throw ScreenCaptureCoordinatorError.recordingRequiresMacOS15
        }

        let content = try await SCShareableContent.current
        guard let display = content.displays.first else {
            throw ScreenCaptureCoordinatorError.noDisplays
        }

        let config = SCStreamConfiguration()
        config.width = display.width
        config.height = display.height
        config.minimumFrameInterval = CMTime(value: 1, timescale: 30)
        config.queueDepth = 5
        config.showsCursor = true
        config.capturesAudio = true
        config.excludesCurrentProcessAudio = false

        let filter = SCContentFilter(display: display, excludingWindows: [])
        let stream = SCStream(filter: filter, configuration: config, delegate: self)
        try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: sampleQueue)

        let recordingConfig = SCRecordingOutputConfiguration()
        recordingConfig.outputURL = outputURL
        recordingConfig.outputFileType = .mp4
        recordingConfig.videoCodecType = .h264
        let recordingOutput = SCRecordingOutput(configuration: recordingConfig, delegate: self)
        try stream.addRecordingOutput(recordingOutput)

        try await stream.startCapture()

        frameCount = 0
        recordingURL = outputURL
        recordingStartDate = Date()
        self.recordingOutput = recordingOutput
        self.stream = stream
        isCapturing = true

        return DisplaySource(
            id: display.displayID,
            name: "Display \(display.displayID)",
            width: display.width,
            height: display.height
        )
    }

    func stop() async throws {
        guard let stream else {
            isCapturing = false
            return
        }
        try await stream.stopCapture()
        self.stream = nil
        isCapturing = false
    }

    func stopRecording() async throws -> RecordedScreenFile {
        guard #available(macOS 15.0, *) else {
            throw ScreenCaptureCoordinatorError.recordingRequiresMacOS15
        }
        guard
            let stream,
            let recordingOutput = recordingOutput as? SCRecordingOutput,
            let recordingURL,
            let recordingStartDate
        else {
            throw ScreenCaptureCoordinatorError.notRecording
        }
        guard recordingFinishContinuation == nil else {
            throw ScreenCaptureCoordinatorError.stopAlreadyInProgress
        }

        let fallbackDuration = Date().timeIntervalSince(recordingStartDate)
        return try await withCheckedThrowingContinuation { continuation in
            recordingFinishContinuation = continuation
            do {
                try stream.removeRecordingOutput(recordingOutput)
                recordingFinishFallbackTask = Task { @MainActor [weak self] in
                    try? await Task.sleep(for: .seconds(5))
                    guard let self, self.recordingFinishContinuation != nil else { return }
                    self.stream = nil
                    self.recordingOutput = nil
                    self.isCapturing = false
                    self.finishRecording(url: recordingURL, duration: fallbackDuration)
                    Task {
                        try? await stream.stopCapture()
                    }
                }
            } catch {
                finishRecording(throwing: error)
            }
        }
    }

    nonisolated func stream(
        _ stream: SCStream,
        didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
        of type: SCStreamOutputType
    ) {
        guard type == .screen, sampleBuffer.isValid else { return }
        if let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) {
            latestScreenLock.lock()
            latestScreenPixelBufferStorage = pixelBuffer
            latestScreenLock.unlock()
        }
        onScreenSampleBuffer?(sampleBuffer)
        Task { @MainActor [weak self] in
            self?.frameCount += 1
        }
    }

    /// Returns the most recently delivered screen frame's pixel buffer,
    /// or nil when no frame has arrived yet. Sampled by the future
    /// CompositeRecorder at draw time — cheap (single-pointer read
    /// behind a mutex). Not nonisolated because the lock is fine to
    /// take from any thread.
    nonisolated func latestScreenPixelBuffer() -> CVPixelBuffer? {
        latestScreenLock.lock()
        defer { latestScreenLock.unlock() }
        return latestScreenPixelBufferStorage
    }
}

enum ScreenCaptureCoordinatorError: LocalizedError {
    case noDisplays
    case notRecording
    case recordingRequiresMacOS15
    case recordingStoppedBeforeFileWasReady
    case stopAlreadyInProgress

    var errorDescription: String? {
        switch self {
        case .noDisplays:
            return "No displays were available to record."
        case .notRecording:
            return "There is no active screen recording to stop."
        case .recordingRequiresMacOS15:
            return "Local MP4 recording requires macOS 15 or newer."
        case .recordingStoppedBeforeFileWasReady:
            return "Recording stopped before the MP4 file was ready."
        case .stopAlreadyInProgress:
            return "Recording stop is already in progress."
        }
    }
}

struct RecordedScreenFile: Equatable, Sendable {
    let url: URL
    let durationSeconds: Double
}

@available(macOS 15.0, *)
extension ScreenCaptureCoordinator: SCRecordingOutputDelegate {
    nonisolated func recordingOutput(
        _ recordingOutput: SCRecordingOutput,
        didFailWithError error: Error
    ) {
        Task { @MainActor [weak self] in
            self?.finishRecording(throwing: error)
        }
    }

    nonisolated func recordingOutputDidFinishRecording(_ recordingOutput: SCRecordingOutput) {
        let recordedDuration = CMTimeGetSeconds(recordingOutput.recordedDuration)
        Task { @MainActor [weak self] in
            guard let self else { return }
            guard let recordingURL else {
                finishRecording(throwing: ScreenCaptureCoordinatorError.recordingStoppedBeforeFileWasReady)
                return
            }
            finishRecording(url: recordingURL, duration: recordedDuration.isFinite ? recordedDuration : 0)
        }
    }

    private func finishRecording(url: URL, duration: Double) {
        guard let continuation = recordingFinishContinuation else {
            return
        }
        recordingFinishFallbackTask?.cancel()
        recordingFinishFallbackTask = nil
        recordingFinishContinuation = nil
        continuation.resume(
            returning: RecordedScreenFile(url: url, durationSeconds: duration)
        )
    }

    private func finishRecording(throwing error: Error) {
        guard let continuation = recordingFinishContinuation else {
            return
        }
        recordingFinishFallbackTask?.cancel()
        recordingFinishFallbackTask = nil
        recordingFinishContinuation = nil
        continuation.resume(throwing: error)
    }
}
