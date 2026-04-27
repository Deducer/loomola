import AVFoundation
import Foundation

final class CompositeRecorder {
    private(set) var outputURL: URL?

    func prepare(outputDirectory: URL) throws {
        outputURL = outputDirectory.appending(path: "composite.mp4")
        // Implementation slice: create AVAssetWriter and pixel-buffer adaptor.
    }

    func appendFramePlaceholder(at time: CMTime, bubblePlacement: BubblePlacement?) {
        // Implementation slice: render ScreenCaptureKit frame + camera frame into a pixel buffer.
        _ = time
        _ = bubblePlacement
    }

    func finish() async throws -> URL {
        guard let outputURL else {
            throw CompositeRecorderError.notPrepared
        }
        return outputURL
    }
}

enum CompositeRecorderError: Error {
    case notPrepared
}
