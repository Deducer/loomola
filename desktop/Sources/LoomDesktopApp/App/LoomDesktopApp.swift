import SwiftUI

@main
struct LoomDesktopApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        WindowGroup("Loom Desktop") {
            MainRecorderView()
                .frame(minWidth: 760, minHeight: 620)
        }
        .windowStyle(.hiddenTitleBar)
    }
}
