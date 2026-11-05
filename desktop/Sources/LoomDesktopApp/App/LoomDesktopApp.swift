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
    @State private var launchGuard: SettingsAutoPresentGuard?

    var body: some View {
        // Read the event here, in the same run-loop pass that presented
        // the scene: the accessor's callback lands a hop later, when a
        // mouse move could already have replaced the ⌘, key event.
        let eventType = NSApp.currentEvent?.type
        let openedByUser = SettingsLaunchGuard.isUserOpened(eventType: eventType)
        let _ = settingsLog.notice("Settings panel body evaluated (event: \(eventType.map { String($0.rawValue) } ?? "none", privacy: .public), userOpened: \(openedByUser, privacy: .public))")
        SettingsSheet(onDismiss: { window?.close() })
            .background(WindowAccessor { settingsWindow in
                window = settingsWindow
                settingsWindow.isRestorable = false
                settingsLog.notice("Settings window attached (visible: \(settingsWindow.isVisible, privacy: .public), userOpened: \(openedByUser, privacy: .public))")
                if !openedByUser, launchGuard == nil {
                    launchGuard = SettingsAutoPresentGuard(window: settingsWindow)
                }
            })
    }
}

/// Closes the Settings window every time SwiftUI shows it on its own.
///
/// SwiftUI presents the first scene whenever it finds no scene window
/// of its own on screen, and the recorder window is AppKit-owned, so it
/// does this at launch and again later (2026-11-05: the window was
/// closed 200 ms after launch and was back on screen a minute later).
/// So the watch lasts as long as the window does. A show that a key
/// press or a menu click is behind (⌘, / the app menu) is the user's
/// and is left alone.
@MainActor
final class SettingsAutoPresentGuard {
    private let window: NSWindow
    private var token: NSObjectProtocol?

    init(window: NSWindow) {
        self.window = window
        token = NotificationCenter.default.addObserver(
            forName: NSWindow.didChangeOcclusionStateNotification,
            object: window,
            queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.windowOcclusionChanged() }
        }
        // The accessor runs before SwiftUI orders the window in, so a
        // synchronous close is a no-op; the first order-in flips the
        // occlusion state and lands above.
        if window.isVisible { windowOcclusionChanged() }
    }

    deinit {
        if let token { NotificationCenter.default.removeObserver(token) }
    }

    private func windowOcclusionChanged() {
        guard window.occlusionState.contains(.visible) || window.isVisible else { return }
        let eventType = NSApp.currentEvent?.type
        if SettingsLaunchGuard.isUserOpened(eventType: eventType) {
            settingsLog.notice("Settings window shown by the user (event: \(eventType.map { String($0.rawValue) } ?? "none", privacy: .public)); keeping it")
            return
        }
        settingsLog.notice("Settings window auto-presented (event: \(eventType.map { String($0.rawValue) } ?? "none", privacy: .public)); closing")
        window.close()
    }
}
