import Foundation

/// Reads the `LOOM_BUILD_COMMIT` + `LOOM_BUILD_DATE` keys out of the
/// bundled `DesktopConfig.plist`. The `build-dev-app.sh` script
/// stamps these on every build so the running app can prove which
/// source revision it came from. Visible in Settings → Account so
/// the user can spot stale installs.
enum BuildStamp {
    static let commit: String = readPlistValue(key: "LOOM_BUILD_COMMIT") ?? "dev"
    static let date: String = readPlistValue(key: "LOOM_BUILD_DATE") ?? "unknown"
    static let appVersion: String = (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String) ?? "0"

    /// Compact "Loomola 0.1.0 · 88c9035 · 2026-05-05" for the
    /// Settings sheet footer. Drops the time portion of the build
    /// date for readability; the full ISO timestamp stays accessible
    /// via `BuildStamp.date`.
    static var displayString: String {
        let day = String(date.prefix(10)) // "2026-05-05T14:32:11Z" → "2026-05-05"
        return "Loomola \(appVersion) · \(commit) · \(day)"
    }

    private static func readPlistValue(key: String) -> String? {
        guard let url = Bundle.main.url(forResource: "DesktopConfig", withExtension: "plist"),
              let data = try? Data(contentsOf: url),
              let plist = try? PropertyListSerialization.propertyList(
                from: data,
                options: [],
                format: nil
              ),
              let dict = plist as? [String: String]
        else { return nil }
        return dict[key]
    }
}
