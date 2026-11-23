import Foundation

/// Decides whether an on-screen window is the one showing a call. Meeting
/// screenshots capture only windows this accepts, so nothing else on the
/// desktop is ever saved to a note.
///
/// A browser window is identified by its title, which is the active tab's
/// title: it only matches while the call tab is in front.
enum MeetingWindowMatcher {
    static func isMeetingWindow(applicationName: String, title: String) -> Bool {
        let application = applicationName.lowercased()
        let windowTitle = title.lowercased()
        if isBrowser(application) {
            return isCallTabTitle(windowTitle)
        }
        // Zoom's floating strip is a thumbnail of faces, never the shared screen.
        if windowTitle.contains("floating video") { return false }
        return MeetingDetector.detect(applicationName: applicationName, title: title) != nil
    }

    private static func isBrowser(_ application: String) -> Bool {
        if application == "arc" || application == "dia" { return true }
        return ["chrome", "chromium", "safari", "firefox", "brave", "microsoft edge", "vivaldi", "opera"]
            .contains { application.contains($0) }
    }

    private static func isCallTabTitle(_ title: String) -> Bool {
        if title.hasPrefix("meet - ") || title.hasPrefix("meet – ") || title.hasPrefix("meet — ") { return true }
        if title.contains("meet.google.com") || title.contains("google meet") { return true }
        if title.contains("zoom meeting") || title.contains("zoom webinar") { return true }
        if title.contains("microsoft teams") && (title.contains("meeting") || title.contains("call")) {
            return true
        }
        return false
    }
}
