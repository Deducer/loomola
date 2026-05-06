import SwiftUI

@main
struct LoomDesktopApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    init() {
        FontLoader.registerAll()
    }

    var body: some Scene {
        WindowGroup("Loomola") {
            MainRecorderView()
                .frame(minWidth: 920, minHeight: 620)
        }
        .windowStyle(.hiddenTitleBar)
        // 1080x740 is a comfortable default — fits 3 video cards
        // (320×180) at xl spacing in the Recent strip plus margins,
        // sits at ~half a 1920×1080 / ~third of a 2560×1440 screen,
        // and matches what user wants ("1/4 to 1/2 of screen"). The
        // 920pt min width ensures toggling between Video and Audio
        // modes can never cause the strip to drop below 3 cards.
        .defaultSize(width: 1080, height: 740)
    }
}
