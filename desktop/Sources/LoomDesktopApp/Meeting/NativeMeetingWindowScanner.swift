import AppKit
import CoreGraphics
import Foundation

/// Low-cost native-app fallback for idle meeting detection. Core Graphics
/// reads the on-screen window list without asking ScreenCaptureKit to rebuild
/// the full shareable-content graph every polling interval.
enum NativeMeetingWindowScanner {
    private static let candidateBundleIdentifiers: Set<String> = [
        "us.zoom.xos",
        "com.microsoft.teams2",
        "Cisco-Systems.Spark",
        "com.apple.FaceTime",
    ]

    static func currentContext(
        runningApplications: [NSRunningApplication] = NSWorkspace.shared.runningApplications
    ) -> MeetingContext? {
        guard runningApplications.contains(where: {
            guard let bundleIdentifier = $0.bundleIdentifier else { return false }
            return candidateBundleIdentifiers.contains(bundleIdentifier)
        }) else { return nil }

        guard let rawWindows = CGWindowListCopyWindowInfo(
            [.optionOnScreenOnly, .excludeDesktopElements],
            kCGNullWindowID
        ) as? [[String: Any]] else { return nil }

        let windows = rawWindows.compactMap { info -> WindowSource? in
            guard (info[kCGWindowLayer as String] as? NSNumber)?.intValue == 0,
                  let owner = info[kCGWindowOwnerName as String] as? String,
                  let title = info[kCGWindowName as String] as? String,
                  !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            else { return nil }
            let id = (info[kCGWindowNumber as String] as? NSNumber)?.uint32Value ?? 0
            return WindowSource(id: id, title: title, applicationName: owner)
        }
        return detect(from: windows)
    }

    static func detect(from windows: [WindowSource]) -> MeetingContext? {
        for window in windows {
            if let context = MeetingDetector.detect(
                applicationName: window.applicationName,
                title: window.title
            ) {
                return context
            }
        }
        return nil
    }
}
