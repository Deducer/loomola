import Foundation

struct MeetingContext: Equatable, Sendable {
    let detectedApp: String
    let sourceContextHint: String
    let suggestedTitle: String
    /// Direct link to the meeting (extracted from window title for
    /// Meet, supplied by the Chrome extension for everything else).
    /// nil when we can't reliably identify a URL — in which case the
    /// "Join meeting" button uses `bundleIdentifier` to activate the
    /// app instead.
    let joinURL: URL?
    /// macOS bundle identifier of the meeting app, used as a fallback
    /// when no URL is available (e.g., Zoom desktop client). Activating
    /// the app brings its window forward.
    let bundleIdentifier: String?
}

enum MeetingDetector {
    static func detect(from snapshot: CaptureSourceSnapshot) -> MeetingContext? {
        for window in snapshot.windows {
            if let context = detect(
                applicationName: window.applicationName,
                title: window.title
            ) {
                return context
            }
        }
        return nil
    }

    static func detect(applicationName: String, title: String) -> MeetingContext? {
        let haystack = "\(applicationName) \(title)".lowercased()
        let hint = "\(applicationName): \(title)"

        if haystack.contains("meet.google.com") || haystack.contains("google meet") {
            return MeetingContext(
                detectedApp: "google-meet",
                sourceContextHint: hint,
                suggestedTitle: suggestedTitle(from: title, fallback: "Google Meet"),
                joinURL: extractMeetURL(from: title) ?? extractMeetURL(from: applicationName),
                bundleIdentifier: chromeBundleIdentifier(for: applicationName)
            )
        }
        if haystack.contains("zoom") {
            return MeetingContext(
                detectedApp: "zoom",
                sourceContextHint: hint,
                suggestedTitle: suggestedTitle(from: title, fallback: "Zoom meeting"),
                joinURL: nil,
                bundleIdentifier: "us.zoom.xos"
            )
        }
        if haystack.contains("microsoft teams") || haystack.contains("teams meeting") {
            return MeetingContext(
                detectedApp: "teams",
                sourceContextHint: hint,
                suggestedTitle: suggestedTitle(from: title, fallback: "Teams meeting"),
                joinURL: nil,
                bundleIdentifier: "com.microsoft.teams2"
            )
        }
        if haystack.contains("webex") {
            return MeetingContext(
                detectedApp: "webex",
                sourceContextHint: hint,
                suggestedTitle: suggestedTitle(from: title, fallback: "Webex meeting"),
                joinURL: nil,
                bundleIdentifier: "Cisco-Systems.Spark"
            )
        }
        if haystack.contains("facetime") {
            return MeetingContext(
                detectedApp: "facetime",
                sourceContextHint: hint,
                suggestedTitle: suggestedTitle(from: title, fallback: "FaceTime call"),
                joinURL: nil,
                bundleIdentifier: "com.apple.FaceTime"
            )
        }

        return nil
    }

    static func suggestedTitle(from windowTitle: String, fallback: String) -> String {
        let trimmed = windowTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        let cleaned = trimmed
            .replacingOccurrences(of: " - meet.google.com", with: "")
            .replacingOccurrences(of: " - Google Chrome", with: "")
            .replacingOccurrences(of: " | Microsoft Teams", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return cleaned.isEmpty ? fallback : cleaned
    }

    /// Pull a Google Meet URL out of a window title. Meet embeds the
    /// path in the title (e.g. "Sprint planning - meet.google.com/abc-defg-hij")
    /// so we can reconstruct the full URL.
    static func extractMeetURL(from text: String) -> URL? {
        let pattern = #"meet\.google\.com/[a-z0-9\-?=&]+"#
        guard
            let range = text.range(of: pattern, options: .regularExpression)
        else { return nil }
        let path = String(text[range])
        return URL(string: "https://\(path)")
    }

    /// Best guess at Chrome's bundle ID based on the app name reported
    /// by ScreenCaptureKit. Defaults to Chrome if nothing matches —
    /// Meet runs in Chrome 95% of the time.
    private static func chromeBundleIdentifier(for applicationName: String) -> String? {
        let lower = applicationName.lowercased()
        if lower.contains("safari") { return "com.apple.Safari" }
        if lower.contains("firefox") { return "org.mozilla.firefox" }
        if lower.contains("arc") { return "company.thebrowser.Browser" }
        if lower.contains("brave") { return "com.brave.Browser" }
        return "com.google.Chrome"
    }
}
