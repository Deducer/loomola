import Foundation
import ServiceManagement

enum LaunchAtLoginController {
    static var isEnabled: Bool {
        SMAppService.mainApp.status == .enabled
    }

    static var statusSummary: String {
        switch SMAppService.mainApp.status {
        case .enabled:
            return "Loomola will start after you sign in to this Mac."
        case .requiresApproval:
            return "Approve Loomola under System Settings → General → Login Items."
        case .notFound:
            return "Launch at Login is available after Loomola is installed in Applications."
        case .notRegistered:
            return "Loomola only checks meetings while it is running."
        @unknown default:
            return "Launch at Login status is unavailable."
        }
    }

    static func setEnabled(_ enabled: Bool) throws {
        if enabled {
            try SMAppService.mainApp.register()
        } else {
            try SMAppService.mainApp.unregister()
        }
    }
}
