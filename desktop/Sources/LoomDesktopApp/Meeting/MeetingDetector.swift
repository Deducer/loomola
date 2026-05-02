import Foundation

struct MeetingContext: Equatable, Sendable {
    let detectedApp: String
    let sourceContextHint: String
    let suggestedTitle: String
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
                suggestedTitle: suggestedTitle(from: title, fallback: "Google Meet")
            )
        }
        if haystack.contains("zoom") {
            return MeetingContext(
                detectedApp: "zoom",
                sourceContextHint: hint,
                suggestedTitle: suggestedTitle(from: title, fallback: "Zoom meeting")
            )
        }
        if haystack.contains("microsoft teams") || haystack.contains("teams meeting") {
            return MeetingContext(
                detectedApp: "teams",
                sourceContextHint: hint,
                suggestedTitle: suggestedTitle(from: title, fallback: "Teams meeting")
            )
        }
        if haystack.contains("webex") {
            return MeetingContext(
                detectedApp: "webex",
                sourceContextHint: hint,
                suggestedTitle: suggestedTitle(from: title, fallback: "Webex meeting")
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
}
