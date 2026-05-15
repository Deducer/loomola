import SwiftUI

@main
struct LoomDesktopApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    init() {
        FontLoader.registerAll()
    }

    var body: some Scene {
        Settings {
            EmptyView()
        }
    }
}
