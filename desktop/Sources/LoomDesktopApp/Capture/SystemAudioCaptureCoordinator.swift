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
    /// When true, incoming system-audio sample buffers are discarded
    /// instead of being written or fed to the level meter. Stream stays
    /// alive so resume is instant. Toggle from AudioNoteRecorder.
    private var paused = false
    var isPaused: Bool {
        get { paused }
        set { paused = newValue }
    }

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
        if paused { return }
        try? writer?.append(sampleBuffer)
        if let level = AudioLevelSampler.linearLevel(from: sampleBuffer) {
            onLevel?(level)
        }
    }
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
