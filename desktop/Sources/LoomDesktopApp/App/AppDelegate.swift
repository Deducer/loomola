import AppKit
import Carbon.HIToolbox
import OSLog

private let bootLog = Logger(subsystem: "cloud.dissonance.loom.desktop", category: "boot")

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
    private var recordHotkey: GlobalHotkey?
    private var wasVideoRecording = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        bootLog.notice("applicationDidFinishLaunching — Loomola booted, OSLog plumbing alive")
        NSLog("[loomola] applicationDidFinishLaunching — boot")
        configureMenuBar()
        configureGlobalHotkeys()
        // Refresh menubar item titles when the recording state flips
        // so "Start Recording" ↔ "Stop Recording" tracks reality.
        // Also auto-show the bubble overlay when video recording
        // starts — that's the 95% case for what the user wants
        // visible. Auto-hide on video stop so the desktop returns to
        // a clean idle state; the user can still pull it back with
        // ⌥⇧B, and the next video recording auto-shows it again.
        NotificationCenter.default.addObserver(
            forName: RecorderCommands.videoRecordingStateChanged,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                self.statusItem?.menu?.update()
                let isVideoRecording = RecorderCommands.isVideoRecording
                if isVideoRecording, self.bubbleOverlay.isVisible == false {
                    self.bubbleOverlay.showPlaceholder()
                } else if !isVideoRecording, self.wasVideoRecording {
                    self.bubbleOverlay.hide()
                }
                self.wasVideoRecording = isVideoRecording
            }
        }
        Task { @MainActor in
            AppActivation.bringRecorderToFront()
        }
    }

    /// Register system-wide keyboard shortcuts via Carbon. Unlike menu
    /// `keyEquivalent` (which only fires when the app is frontmost),
    /// these always reach us regardless of which app has focus —
    /// the right primitive for a status-bar app.
    ///
    /// Defaults:
    ///   ⌥⇧B — toggles the bubble overlay.
    ///   ⌥⇧R — toggles composite recording (start if idle, stop +
    ///         upload if recording). Routed to the view model via
    ///         RecorderCommands.toggleRecording NotificationCenter
    ///         broadcast.
    /// Avoid ⌘-only modifiers since every browser, text editor,
    /// and Slack hook them for other things.
    private func configureGlobalHotkeys() {
        bubbleHotkey = GlobalHotkey(
            keyCode: UInt32(kVK_ANSI_B),
            modifiers: UInt32(optionKey | shiftKey),
            handler: { [weak self] in
                Task { @MainActor in
                    self?.toggleBubbleOverlay()
                }
            }
        )
        recordHotkey = GlobalHotkey(
            keyCode: UInt32(kVK_ANSI_R),
            modifiers: UInt32(optionKey | shiftKey),
            handler: {
                RecorderCommands.postToggleRecording()
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

        // Toggle Recording menu item — fires the same notification as
        // the ⌥⇧R global hotkey. View model in MainRecorderView
        // subscribes and decides start vs stop based on state.
        let recordItem = NSMenuItem(title: "Start Recording", action: #selector(toggleRecording), keyEquivalent: "r")
        recordItem.keyEquivalentModifierMask = [.option, .shift]
        menu.addItem(recordItem)

        // Bubble overlay toggle — title updates in validateMenuItem.
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

    @objc private func toggleRecording() {
        RecorderCommands.postToggleRecording()
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

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard RecorderCommands.isAnyRecording else {
            return .terminateNow
        }

        let alert = NSAlert()
        alert.messageText = "Recording in progress"
        alert.informativeText = "Quit Loomola and discard the current recording?"
        alert.alertStyle = .warning
        alert.addButton(withTitle: "Keep Recording")
        let discardButton = alert.addButton(withTitle: "Discard & Quit")
        discardButton.hasDestructiveAction = true

        let response = alert.runModal()
        if response == .alertSecondButtonReturn {
            RecorderCommands.postDiscardRecordingAndQuit()
            return .terminateLater
        }

        AppActivation.bringRecorderToFront()
        return .terminateCancel
    }
}

extension AppDelegate: NSMenuItemValidation {
    func validateMenuItem(_ menuItem: NSMenuItem) -> Bool {
        if menuItem.action == #selector(toggleBubbleOverlay) {
            menuItem.title = bubbleOverlay.isVisible
                ? "Hide Bubble Overlay"
                : "Show Bubble Overlay"
        } else if menuItem.action == #selector(toggleRecording) {
            menuItem.title = RecorderCommands.isVideoRecording
                ? "Stop Recording"
                : "Start Recording"
        }
        return true
    }
}
