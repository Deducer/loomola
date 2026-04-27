import AppKit

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem?
    private let bubbleOverlay = BubbleOverlayWindowController()

    func applicationDidFinishLaunching(_ notification: Notification) {
        configureMenuBar()
    }

    private func configureMenuBar() {
        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        item.button?.title = "Loom"

        let menu = NSMenu()
        menu.addItem(NSMenuItem(title: "Start Recording", action: #selector(startRecording), keyEquivalent: "r"))
        menu.addItem(NSMenuItem(title: "Show Bubble Overlay", action: #selector(showBubbleOverlay), keyEquivalent: "b"))
        menu.addItem(NSMenuItem.separator())
        menu.addItem(NSMenuItem(title: "Open Dashboard", action: #selector(openDashboard), keyEquivalent: "d"))
        menu.addItem(NSMenuItem.separator())
        menu.addItem(NSMenuItem(title: "Quit", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
        item.menu = menu
        statusItem = item
    }

    @objc private func startRecording() {
        NSApp.activate(ignoringOtherApps: true)
    }

    @objc private func showBubbleOverlay() {
        bubbleOverlay.showPlaceholder()
    }

    @objc private func openDashboard() {
        NSWorkspace.shared.open(URL(string: "https://loom.dissonance.cloud")!)
    }
}
