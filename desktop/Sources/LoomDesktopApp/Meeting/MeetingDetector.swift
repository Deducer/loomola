import Foundation

struct MeetingContext: Equatable, Sendable {
    let detectedApp: String
    let sourceContextHint: String
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
            return MeetingContext(detectedApp: "google-meet", sourceContextHint: hint)
        }
        if haystack.contains("zoom") {
            return MeetingContext(detectedApp: "zoom", sourceContextHint: hint)
        }
        if haystack.contains("microsoft teams") || haystack.contains("teams meeting") {
            return MeetingContext(detectedApp: "teams", sourceContextHint: hint)
        }
        if haystack.contains("webex") {
            return MeetingContext(detectedApp: "webex", sourceContextHint: hint)
        }

        return nil
    }
}
