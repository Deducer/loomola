import SwiftUI

@main
struct LoomDesktopApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    init() {
        FontLoader.registerAll()
    }

    var body: some Scene {
        Settings {
            NativeSettingsPanel()
                .environmentObject(appDelegate.recorderViewModel)
                .environmentObject(appDelegate.onboardingProgress)
        }
    }
}

private struct NativeSettingsPanel: View {
    @State private var window: NSWindow?

    var body: some View {
        SettingsSheet(onDismiss: { window?.close() })
            .background(WindowAccessor { settingsWindow in
                window = settingsWindow
                settingsWindow.isRestorable = false
            })
    }
}
