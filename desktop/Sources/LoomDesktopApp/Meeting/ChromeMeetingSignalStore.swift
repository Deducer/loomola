import Foundation

struct ChromeMeetingSignal: Codable, Equatable, Sendable {
    let event: String
    let source: String
    let title: String?
    let tabUrl: String?
    let ts: Double
    let receivedAt: Double
}

enum ChromeMeetingSignalStore {
    static func readLatest(
        now: Date = Date(),
        maxAgeSeconds: TimeInterval = 120,
        fileURL: URL = signalFileURL()
    ) -> MeetingContext? {
        guard
            let data = try? Data(contentsOf: fileURL),
            let signal = try? JSONDecoder().decode(ChromeMeetingSignal.self, from: data)
        else {
            return nil
        }
        guard signal.event == "meeting-active" else { return nil }
        guard now.timeIntervalSince1970 - (signal.receivedAt / 1000) <= maxAgeSeconds else {
            return nil
        }
        return context(from: signal)
    }

    static func context(from signal: ChromeMeetingSignal) -> MeetingContext? {
        guard ["meet", "teams", "zoom"].contains(signal.source) else { return nil }
        let fallback = fallbackTitle(for: signal.source)
        let title = MeetingDetector.suggestedTitle(from: signal.title ?? "", fallback: fallback)
        let hintParts = [
            sourceLabel(for: signal.source),
            signal.title?.trimmingCharacters(in: .whitespacesAndNewlines),
            signal.tabUrl
        ].compactMap { part in
            let trimmed = part?.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed?.isEmpty == false ? trimmed : nil
        }
        let joinURL = signal.tabUrl.flatMap { URL(string: $0) }
        return MeetingContext(
            detectedApp: signal.source,
            sourceContextHint: hintParts.joined(separator: ": "),
            suggestedTitle: title,
            joinURL: joinURL,
            // Chrome signals always come from a browser tab, so Chrome
            // is the right activation fallback when we have no URL.
            bundleIdentifier: joinURL == nil ? "com.google.Chrome" : nil
        )
    }

    static func signalFileURL(
        fileManager: FileManager = .default
    ) -> URL {
        let base = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSHomeDirectory()).appending(path: "Library/Application Support")
        return base
            .appending(path: "LoomDesktop", directoryHint: .isDirectory)
            .appending(path: "chrome-meeting-signal.json")
    }

    private static func fallbackTitle(for source: String) -> String {
        if source == "meet" { return "Google Meet" }
        if source == "teams" { return "Teams meeting" }
        if source == "zoom" { return "Zoom meeting" }
        return "Meeting"
    }

    private static func sourceLabel(for source: String) -> String {
        if source == "meet" { return "Google Meet" }
        if source == "teams" { return "Microsoft Teams" }
        if source == "zoom" { return "Zoom" }
        return "Meeting"
    }
}
