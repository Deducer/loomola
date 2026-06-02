import AppKit
import CoreText
import Foundation

/// Registers Loomola's bundled fonts (Inter + JetBrains Mono) with
/// CoreText so SwiftUI's `Font.custom("Inter", size:)` resolves
/// instead of silently falling back to the system font.
///
/// Called once from `LoomDesktopApp.init()`. Idempotent — Core Text
/// rejects duplicate registration with `kCTFontManagerErrorAlreadyRegistered`,
/// which we swallow.
enum FontLoader {
    static let interFamilyName = "Inter"
    static let jetBrainsMonoFamilyName = "JetBrains Mono"

    /// Register all bundled fonts. Logs a single line per font.
    static func registerAll() {
        register(filename: "Inter-VariableFont", ext: "ttf", label: "Inter")
        register(filename: "JetBrainsMono-VariableFont", ext: "ttf", label: "JetBrains Mono")
    }

    private static func register(filename: String, ext: String, label: String) {
        guard let url = fontURL(filename: filename, ext: ext) else {
            print("[fonts] \(label) — resource not found in bundle; falling back to system font")
            return
        }
        var error: Unmanaged<CFError>?
        let ok = CTFontManagerRegisterFontsForURL(url as CFURL, .process, &error)
        if ok {
            print("[fonts] \(label) registered from \(url.lastPathComponent)")
        } else if let err = error?.takeRetainedValue() {
            // Already registered counts as success for our purposes.
            let domain = CFErrorGetDomain(err) as String
            let code = CFErrorGetCode(err)
            if domain == kCTFontManagerErrorDomain as String, code == 105 {
                // 105 = kCTFontManagerErrorAlreadyRegistered
                return
            }
            print("[fonts] \(label) registration failed: \(err)")
        }
    }

    private static func fontURL(filename: String, ext: String) -> URL? {
        if let url = Bundle.main.url(forResource: filename, withExtension: ext, subdirectory: "Fonts")
            ?? Bundle.main.url(forResource: "Fonts/\(filename)", withExtension: ext) {
            return url
        }

        for bundle in resourceBundles() {
            if let url = bundle.url(forResource: filename, withExtension: ext, subdirectory: "Fonts")
                ?? bundle.url(forResource: "Fonts/\(filename)", withExtension: ext) {
                return url
            }
        }

        return nil
    }

    private static func resourceBundles() -> [Bundle] {
        let bundleNames = [
            "LoomDesktop_LoomDesktopApp",
            "LoomDesktopApp_LoomDesktopApp"
        ]
        let searchRoots = [
            Bundle.main.resourceURL,
            Bundle.main.bundleURL,
            URL(fileURLWithPath: CommandLine.arguments[0]).deletingLastPathComponent()
        ].compactMap { $0 }

        return bundleNames.flatMap { bundleName in
            searchRoots.compactMap { root in
                let url = root.appendingPathComponent("\(bundleName).bundle")
                return Bundle(url: url)
            }
        }
    }
}
