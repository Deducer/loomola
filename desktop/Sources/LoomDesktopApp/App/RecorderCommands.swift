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

    /// Posted when any recording active state changes. The menubar
    /// uses it to refresh titles; AppDelegate uses it to guard Quit.
    static let videoRecordingStateChanged = Notification.Name("loomola.videoRecordingStateChanged")

    /// Posted by AppDelegate when the user chooses Discard & Quit
    /// from the Cmd-Q safety dialog. MainRecorderView owns the view
    /// model, so it performs the actual recorder teardown and then
    /// replies to AppKit's pending termination request.
    static let discardRecordingAndQuit = Notification.Name("loomola.discardRecordingAndQuit")

    static func postToggleRecording() {
        NotificationCenter.default.post(name: toggleRecording, object: nil)
    }

    static func postDiscardRecordingAndQuit() {
        NotificationCenter.default.post(name: discardRecordingAndQuit, object: nil)
    }

    /// Set by the view model whenever a video composite recording
    /// starts or stops. Read by AppDelegate's validateMenuItem to
    /// flip the Start/Stop title. Plain atomic — only the view model
    /// (main actor) writes; menubar reads happen on main too.
    private static let lock = NSLock()
    nonisolated(unsafe) private static var _isVideoRecording = false
    nonisolated(unsafe) private static var _isAudioRecording = false

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

    static var isAudioRecording: Bool {
        get {
            lock.lock(); defer { lock.unlock() }
            return _isAudioRecording
        }
        set {
            lock.lock()
            let changed = _isAudioRecording != newValue
            _isAudioRecording = newValue
            lock.unlock()
            if changed {
                NotificationCenter.default.post(name: videoRecordingStateChanged, object: nil)
            }
        }
    }

    static var isAnyRecording: Bool {
        lock.lock(); defer { lock.unlock() }
        return _isVideoRecording || _isAudioRecording
    }
}
