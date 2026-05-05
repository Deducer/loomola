import AppKit
import Carbon.HIToolbox

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem?
    /// Bubble overlay wraps the shared camera + position-controller
    /// singletons (CameraCaptureCoordinator.shared,
    /// BubblePositionController.shared) so the RecorderViewModel's
    /// composite recorder reads from the same instances.
    private lazy var bubbleOverlay = BubbleOverlayWindowController(
        positionController: BubblePositionController.shared,
        cameraCoordinator: CameraCaptureCoordinator.shared
    )
    private var bubbleHotkey: GlobalHotkey?

    func applicationDidFinishLaunching(_ notification: Notification) {
        configureMenuBar()
        configureGlobalHotkeys()
        Task { @MainActor in
            AppActivation.bringRecorderToFront()
        }
    }

    /// Register system-wide keyboard shortcuts via Carbon. Unlike menu
    /// `keyEquivalent` (which only fires when the app is frontmost),
    /// these always reach us regardless of which app has focus —
    /// the right primitive for a status-bar app.
    ///
    /// Default: ⌥⇧B toggles the bubble overlay. Avoids ⌘B since
    /// every browser, every text editor, and Slack all hook ⌘B for
    /// other things, and a global ⌘B would conflict everywhere.
    private func configureGlobalHotkeys() {
        bubbleHotkey = GlobalHotkey(
            keyCode: UInt32(kVK_ANSI_B),
            modifiers: UInt32(optionKey | shiftKey),
            handler: { [weak self] in
                self?.toggleBubbleOverlay()
            }
        )
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
        menu.addItem(NSMenuItem(title: "Show Recorder", action: #selector(showRecorder), keyEquivalent: ""))
        // Title is updated dynamically in validateMenuItem to reflect the
        // current overlay visibility — see toggleBubbleOverlay below.
        // No keyEquivalent on this menu item — the real shortcut is the
        // ⌥⇧B Carbon global hotkey registered in configureGlobalHotkeys.
        // We surface the keystroke as a visible hint via setKeyEquivalent
        // + setKeyEquivalentModifierMask below so users see "⌥⇧B" next
        // to the menu label.
        let bubbleItem = NSMenuItem(title: "Show Bubble Overlay", action: #selector(toggleBubbleOverlay), keyEquivalent: "b")
        bubbleItem.keyEquivalentModifierMask = [.option, .shift]
        menu.addItem(bubbleItem)
        menu.addItem(NSMenuItem.separator())
        menu.addItem(NSMenuItem(title: "Open Dashboard", action: #selector(openDashboard), keyEquivalent: ""))
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
