import Foundation

/// Extracts a joinable video-conference URL from free text (calendar
/// event URL/location/notes). Calendar invites bury the real link in
/// different fields per organizer tool, so callers concatenate whatever
/// they have and let the first known-provider match win.
enum ConferenceLink {
    /// Ordered by specificity — a Zoom invite's notes often ALSO contain
    /// a generic zoom.us support link, so the /j/ join form goes first.
    private static let patterns: [String] = [
        #"https://[a-zA-Z0-9.-]*zoom\.us/j/[^\s<>"')\]]+"#,
        #"https://[a-zA-Z0-9.-]*zoom\.us/s/[^\s<>"')\]]+"#,
        #"https://meet\.google\.com/[a-z]{3}-[a-z]{4}-[a-z]{3}[^\s<>"')\]]*"#,
        #"https://teams\.microsoft\.com/l/meetup-join/[^\s<>"')\]]+"#,
        #"https://facetime\.apple\.com/join[^\s<>"')\]]+"#,
        #"https://[a-zA-Z0-9.-]*webex\.com/[a-zA-Z0-9.-]*/j\.php[^\s<>"')\]]+"#,
    ]

    static func extract(from text: String) -> URL? {
        guard !text.isEmpty else { return nil }
        for pattern in patterns {
            guard let regex = try? NSRegularExpression(pattern: pattern) else { continue }
            let range = NSRange(text.startIndex..., in: text)
            guard let match = regex.firstMatch(in: text, range: range),
                  let swiftRange = Range(match.range, in: text)
            else { continue }
            // Trim trailing punctuation that often rides along in prose
            // ("join here: https://zoom.us/j/123.").
            let raw = String(text[swiftRange])
            let trimmed = raw.trimmingCharacters(in: CharacterSet(charactersIn: ".,;"))
            if let url = URL(string: trimmed) { return url }
        }
        return nil
    }
}
