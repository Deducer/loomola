import Foundation

/// Notification names used to bridge menubar / global-hotkey actions
/// (owned by AppDelegate) to the recorder view model (owned by
/// MainRecorderView). The view model can't be referenced directly
/// from AppDelegate because SwiftUI owns its lifecycle; notifications
/// are the simplest cross-cut.
enum RecorderCommands {
    /// Posted to toggle composite recording: starts if idle, stops +
    /// uploads if currently recording. Receiver maps to view-model
    /// state.
    static let toggleRecording = Notification.Name("loomola.toggleRecording")

    static func postToggleRecording() {
        NotificationCenter.default.post(name: toggleRecording, object: nil)
    }
}
