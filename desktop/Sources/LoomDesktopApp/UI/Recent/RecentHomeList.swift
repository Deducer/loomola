import Foundation

/// What the recent list shows on each surface. Home is one
/// date-grouped list of notes *and* videos (Loomola carries both
/// products); Videos is that same list filtered to videos. Pure so
/// the rule is testable.
enum RecentHomeList {
    static func visibleItems(
        _ items: [RecentRecording],
        captureMode: CaptureMode,
        folderFilterId: String?
    ) -> [RecentRecording] {
        let byKind: [RecentRecording]
        switch captureMode {
        case .video: byKind = items.filter { $0.kind == .video }
        case .audio: byKind = items
        }
        guard let folderFilterId else { return byKind }
        return byKind.filter { $0.folderId == folderFilterId }
    }

    /// "3:28" / "1:02:05" for a video row's subtitle.
    static func durationLabel(seconds: Double?) -> String? {
        guard let seconds, seconds.isFinite, seconds > 0 else { return nil }
        let total = Int(seconds.rounded())
        let h = total / 3600, m = (total % 3600) / 60, s = total % 60
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, s) : String(format: "%d:%02d", m, s)
    }
}
