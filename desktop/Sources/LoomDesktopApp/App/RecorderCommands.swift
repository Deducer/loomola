import Foundation

/// Notification names + shared state used to bridge menubar /
/// global-hotkey actions (owned by AppDelegate) to the recorder view
/// model (owned by MainRecorderView). The view model can't be
/// referenced directly from AppDelegate because SwiftUI owns its
/// lifecycle; notifications + a tiny shared atomic are the simplest
/// cross-cut.
enum RecorderCommands {
    /// Posted to toggle composite recording: starts if idle, stops +
    /// uploads if currently recording. Receiver maps to view-model
    /// state.
    static let toggleRecording = Notification.Name("loomola.toggleRecording")

    /// Posted when the video-recording active state changes. The
    /// menubar uses it to refresh the Start/Stop item title.
    static let videoRecordingStateChanged = Notification.Name("loomola.videoRecordingStateChanged")

    static func postToggleRecording() {
        NotificationCenter.default.post(name: toggleRecording, object: nil)
    }

    /// Set by the view model whenever a video composite recording
    /// starts or stops. Read by AppDelegate's validateMenuItem to
    /// flip the Start/Stop title. Plain atomic — only the view model
    /// (main actor) writes; menubar reads happen on main too.
    private static let lock = NSLock()
    nonisolated(unsafe) private static var _isVideoRecording = false

    static var isVideoRecording: Bool {
        get {
            lock.lock(); defer { lock.unlock() }
            return _isVideoRecording
        }
        set {
            lock.lock()
            let changed = _isVideoRecording != newValue
            _isVideoRecording = newValue
            lock.unlock()
            if changed {
                NotificationCenter.default.post(name: videoRecordingStateChanged, object: nil)
            }
        }
    }
}
