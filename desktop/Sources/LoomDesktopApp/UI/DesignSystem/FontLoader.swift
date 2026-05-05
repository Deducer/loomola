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
        guard let url = Bundle.module.url(
            forResource: "Fonts/\(filename)",
            withExtension: ext
        ) ?? Bundle.module.url(forResource: filename, withExtension: ext) else {
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
}
