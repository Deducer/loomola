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
    private let sampleQueue = DispatchQueue(label: "cloud.dissonance.loom.desktop.screen-samples")

    func requestShareableContent() async throws {
        _ = try await SCShareableContent.current
    }

    func startFirstDisplayCapture() async throws -> DisplaySource {
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
        try await stream.startCapture()

        frameCount = 0
        self.stream = stream
        isCapturing = true
        return DisplaySource(
            id: display.displayID,
            name: "Display \(display.displayID)",
            width: display.width,
            height: display.height
        )
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

        let fallbackDuration = Date().timeIntervalSince(recordingStartDate)
        return try await withCheckedThrowingContinuation { continuation in
            recordingFinishContinuation = continuation
            do {
                try stream.removeRecordingOutput(recordingOutput)
                Task { @MainActor in
                    try? await stream.stopCapture()
                    self.stream = nil
                    self.recordingOutput = nil
                    self.isCapturing = false
                    if self.recordingFinishContinuation != nil {
                        self.finishRecording(url: recordingURL, duration: fallbackDuration)
                    }
                }
            } catch {
                recordingFinishContinuation = nil
                continuation.resume(throwing: error)
            }
        }
    }

    nonisolated func stream(
        _ stream: SCStream,
        didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
        of type: SCStreamOutputType
    ) {
        guard type == .screen, sampleBuffer.isValid else { return }
        Task { @MainActor [weak self] in
            self?.frameCount += 1
        }
    }
}

enum ScreenCaptureCoordinatorError: Error {
    case noDisplays
    case notRecording
    case recordingRequiresMacOS15
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
            self?.recordingFinishContinuation?.resume(throwing: error)
            self?.recordingFinishContinuation = nil
        }
    }

    nonisolated func recordingOutputDidFinishRecording(_ recordingOutput: SCRecordingOutput) {
        let recordedDuration = CMTimeGetSeconds(recordingOutput.recordedDuration)
        Task { @MainActor [weak self] in
            guard let self, let recordingURL else { return }
            finishRecording(url: recordingURL, duration: recordedDuration.isFinite ? recordedDuration : 0)
        }
    }

    private func finishRecording(url: URL, duration: Double) {
        recordingFinishContinuation?.resume(
            returning: RecordedScreenFile(url: url, durationSeconds: duration)
        )
        recordingFinishContinuation = nil
    }
}
