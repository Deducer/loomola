import AppKit
import Foundation

/// One-shot relaunch helper. Used when macOS requires the running
/// process to restart after a permission change — most notably
/// Screen Recording, which the OS only re-evaluates at process
/// start.
///
/// Implementation: launch a NEW instance of ourselves via
/// NSWorkspace with `createsNewApplicationInstance = true`, then
/// terminate the current process after a short delay so the new
/// instance has a chance to register. macOS deduplicates
/// `cloud.dissonance.loom.desktop` automatically once we exit.
enum AppRelauncher {
    @MainActor
    static func relaunch() {
        let bundleURL = Bundle.main.bundleURL
        let config = NSWorkspace.OpenConfiguration()
        config.createsNewApplicationInstance = true
        NSWorkspace.shared.openApplication(at: bundleURL, configuration: config) { _, _ in
            // Fire on the main thread regardless of completion thread.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                NSApp.terminate(nil)
            }
        }
    }
}
