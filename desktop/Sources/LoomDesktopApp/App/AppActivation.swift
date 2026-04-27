import AppKit

@MainActor
enum AppActivation {
    static func bringRecorderToFront() {
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)

        guard let recorderWindow = NSApp.windows.first(where: { window in
            !(window is NSPanel) && window.canBecomeKey
        }) else {
            return
        }

        recorderWindow.makeKeyAndOrderFront(nil)
    }
}
