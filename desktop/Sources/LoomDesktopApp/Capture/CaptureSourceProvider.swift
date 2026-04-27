import AVFoundation
import Foundation
import ScreenCaptureKit

struct CaptureSourceSnapshot: Equatable, Sendable {
    var displays: [DisplaySource]
    var windows: [WindowSource]
    var cameras: [MediaDeviceSource]
    var microphones: [MediaDeviceSource]
}

struct DisplaySource: Identifiable, Equatable, Sendable {
    let id: UInt32
    let name: String
    let width: Int
    let height: Int
}

struct WindowSource: Identifiable, Equatable, Sendable {
    let id: UInt32
    let title: String
    let applicationName: String
}

struct MediaDeviceSource: Identifiable, Equatable, Sendable {
    let id: String
    let name: String
}

@available(macOS 14.0, *)
struct CaptureSourceProvider: Sendable {
    func snapshot() async throws -> CaptureSourceSnapshot {
        let content = try await SCShareableContent.current
        return CaptureSourceSnapshot(
            displays: content.displays.map { display in
                DisplaySource(
                    id: display.displayID,
                    name: "Display \(display.displayID)",
                    width: display.width,
                    height: display.height
                )
            },
            windows: content.windows
                .filter(\.isOnScreen)
                .prefix(50)
                .map { window in
                    WindowSource(
                        id: window.windowID,
                        title: window.title ?? "Untitled window",
                        applicationName: window.owningApplication?.applicationName ?? "Unknown app"
                    )
                },
            cameras: Self.videoDevices().map {
                MediaDeviceSource(id: $0.uniqueID, name: $0.localizedName)
            },
            microphones: Self.audioDevices().map {
                MediaDeviceSource(id: $0.uniqueID, name: $0.localizedName)
            }
        )
    }

    private static func videoDevices() -> [AVCaptureDevice] {
        AVCaptureDevice.DiscoverySession(
            deviceTypes: [.builtInWideAngleCamera, .external],
            mediaType: .video,
            position: .unspecified
        ).devices
    }

    private static func audioDevices() -> [AVCaptureDevice] {
        AVCaptureDevice.DiscoverySession(
            deviceTypes: [.microphone, .external],
            mediaType: .audio,
            position: .unspecified
        ).devices
    }
}
