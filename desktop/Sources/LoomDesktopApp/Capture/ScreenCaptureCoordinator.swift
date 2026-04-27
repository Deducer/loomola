import Foundation
import CoreMedia
import ScreenCaptureKit

@available(macOS 14.0, *)
@MainActor
final class ScreenCaptureCoordinator: NSObject, SCStreamOutput, SCStreamDelegate {
    private(set) var isCapturing = false
    private(set) var frameCount = 0
    private var stream: SCStream?
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

    func stop() async throws {
        guard let stream else {
            isCapturing = false
            return
        }
        try await stream.stopCapture()
        self.stream = nil
        isCapturing = false
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
}
