import SwiftUI
import os.log

private let settingsLog = Logger(subsystem: "cloud.dissonance.loom.desktop", category: "settings")

@main
struct LoomDesktopApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    init() {
        FontLoader.registerAll()
    }

    /// The recorder window is AppKit-owned (AppDelegate.showRecorder), so
    /// Settings is the only SwiftUI scene. With the default launch
    /// behaviour SwiftUI presents the first scene nothing else has
    /// presented, which put the Settings window on screen at every
    /// launch. `.defaultLaunchBehavior(.suppressed)` would fix it on
    /// macOS 15+, but SceneBuilder can't gate it behind #available at
    /// the macOS 14 target, so NativeSettingsPanel closes the window
    /// when no user action (⌘, / the menu) is behind its appearance.
    var body: some Scene {
        Settings {
            NativeSettingsPanel()
                .environmentObject(appDelegate.recorderViewModel)
                .environmentObject(appDelegate.onboardingProgress)
        }
    }
}

/// Tells a Settings window the user asked for from one SwiftUI presented
/// on its own at launch (see LoomDesktopApp.body).
enum SettingsLaunchGuard {
    /// Event types a person produces to open Settings: ⌘, is a key
    /// equivalent (keyDown) and a menu pick ends on mouse-up. Launch
    /// activation, mouse moves and the like are not requests.
    static func isUserOpened(eventType: NSEvent.EventType?) -> Bool {
        guard let eventType else { return false }
        switch eventType {
        case .keyDown, .keyUp, .leftMouseDown, .leftMouseUp, .rightMouseDown, .rightMouseUp, .otherMouseUp:
            return true
        default:
            return false
        }
    }
}

private struct NativeSettingsPanel: View {
    @State private var window: NSWindow?

    var body: some View {
        // Read the event here, in the same run-loop pass that presented
        // the scene: the accessor's callback lands a hop later, when a
        // mouse move could already have replaced the ⌘, key event.
        let eventType = NSApp.currentEvent?.type
        let openedByUser = SettingsLaunchGuard.isUserOpened(eventType: eventType)
        SettingsSheet(onDismiss: { window?.close() })
            .background(WindowAccessor { settingsWindow in
                window = settingsWindow
                settingsWindow.isRestorable = false
                settingsLog.info("Settings window attached (event: \(eventType.map { String($0.rawValue) } ?? "none"), userOpened: \(openedByUser))")
                if !openedByUser {
                    Self.dismissAutoPresented(settingsWindow)
                }
            })
    }

    /// The accessor runs before SwiftUI orders the window in, so a
    /// synchronous close is a no-op. Close the moment the window first
    /// becomes visible (occlusion state flips as it is ordered in), and
    /// keep polling briefly as a backstop: a cold first launch after an
    /// install can order the window in well after the first second.
    private static func dismissAutoPresented(_ window: NSWindow) {
        var token: NSObjectProtocol?
        token = NotificationCenter.default.addObserver(
            forName: NSWindow.didChangeOcclusionStateNotification,
            object: window,
            queue: .main
        ) { _ in
            guard window.occlusionState.contains(.visible) else { return }
            settingsLog.info("Settings window auto-presented at launch; closing")
            window.close()
            if let token { NotificationCenter.default.removeObserver(token) }
        }
        pollAndClose(window, attempt: 0) {
            if let token { NotificationCenter.default.removeObserver(token) }
        }
    }

    private static func pollAndClose(_ window: NSWindow, attempt: Int, done: @escaping () -> Void) {
        DispatchQueue.main.asyncAfter(deadline: .now() + (attempt == 0 ? 0 : 0.25)) {
            if window.isVisible {
                settingsLog.info("Settings window auto-presented at launch; closing (poll \(attempt))")
                window.close()
            }
            if attempt < 12 { pollAndClose(window, attempt: attempt + 1, done: done) } else { done() }
        }
    }
}
