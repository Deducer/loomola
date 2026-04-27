import Foundation
import ScreenCaptureKit

@available(macOS 14.0, *)
final class ScreenCaptureCoordinator: NSObject {
    private(set) var isCapturing = false

    func requestShareableContent() async throws {
        // Implementation slice: call SCShareableContent and expose displays/windows.
        // Keep this object focused on ScreenCaptureKit; compositing lives elsewhere.
    }

    func startSingleDisplayCapture() async throws {
        isCapturing = true
    }

    func stop() {
        isCapturing = false
    }
}
