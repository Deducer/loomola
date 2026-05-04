import AppKit

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem?
    private let bubbleOverlay = BubbleOverlayWindowController()

    func applicationDidFinishLaunching(_ notification: Notification) {
        configureMenuBar()
        Task { @MainActor in
            AppActivation.bringRecorderToFront()
        }
    }

    private func configureMenuBar() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let button = item.button {
            if let image = NSImage(named: "loomola-logo-mark") {
                // Constrain to a sensible menubar height (~18pt). Don't mark
                // as a template image — the loomola mark is intentionally
                // colored and should keep its blue/green branding.
                image.size = NSSize(width: 18, height: 18)
                image.isTemplate = false
                button.image = image
                button.imagePosition = .imageOnly
            } else {
                button.title = "Loomola"
            }
        }

        let menu = NSMenu()
        menu.addItem(NSMenuItem(title: "Show Recorder", action: #selector(showRecorder), keyEquivalent: "r"))
        // Title is updated dynamically in validateMenuItem to reflect the
        // current overlay visibility — see toggleBubbleOverlay below.
        menu.addItem(NSMenuItem(title: "Show Bubble Overlay", action: #selector(toggleBubbleOverlay), keyEquivalent: "b"))
        menu.addItem(NSMenuItem.separator())
        menu.addItem(NSMenuItem(title: "Open Dashboard", action: #selector(openDashboard), keyEquivalent: "d"))
        menu.addItem(NSMenuItem.separator())
        menu.addItem(NSMenuItem(title: "Quit", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
        item.menu = menu
        statusItem = item
    }

    @objc private func showRecorder() {
        AppActivation.bringRecorderToFront()
    }

    @objc private func toggleBubbleOverlay() {
        if bubbleOverlay.isVisible {
            bubbleOverlay.hide()
        } else {
            bubbleOverlay.showPlaceholder()
        }
    }

    @objc private func openDashboard() {
        NSWorkspace.shared.open(URL(string: "https://loom.dissonance.cloud")!)
    }
}

extension AppDelegate: NSMenuItemValidation {
    func validateMenuItem(_ menuItem: NSMenuItem) -> Bool {
        if menuItem.action == #selector(toggleBubbleOverlay) {
            menuItem.title = bubbleOverlay.isVisible
                ? "Hide Bubble Overlay"
                : "Show Bubble Overlay"
        }
        return true
    }
}
