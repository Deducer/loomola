import SwiftUI

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
    /// when it was presented by launch rather than by ⌘, / the menu.
    var body: some Scene {
        Settings {
            NativeSettingsPanel()
                .environmentObject(appDelegate.recorderViewModel)
                .environmentObject(appDelegate.onboardingProgress)
        }
    }
}

private struct NativeSettingsPanel: View {
    /// A Settings window that appears this soon after launch was not
    /// asked for (see LoomDesktopApp.body).
    static let autoPresentedWindowSeconds: TimeInterval = 3
    @State private var window: NSWindow?

    var body: some View {
        SettingsSheet(onDismiss: { window?.close() })
            .background(WindowAccessor { settingsWindow in
                window = settingsWindow
                settingsWindow.isRestorable = false
                if AppDelegate.secondsSinceLaunch < Self.autoPresentedWindowSeconds {
                    Self.dismissAutoPresented(settingsWindow)
                }
            })
    }

    /// The accessor runs before SwiftUI orders the window in, so a
    /// synchronous close is a no-op. Close once it is visible, and keep
    /// checking briefly in case the order-front lands a tick later.
    private static func dismissAutoPresented(_ window: NSWindow, attempt: Int = 0) {
        DispatchQueue.main.asyncAfter(deadline: .now() + (attempt == 0 ? 0 : 0.25)) {
            if window.isVisible { window.close() }
            if attempt < 6 { dismissAutoPresented(window, attempt: attempt + 1) }
        }
    }
}
