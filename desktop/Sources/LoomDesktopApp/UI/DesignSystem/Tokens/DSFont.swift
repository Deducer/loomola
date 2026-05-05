import AppKit
import SwiftUI

/// Loomola typography tokens. Display + body in Inter; timer + diagnostics
/// in JetBrains Mono. Both fonts are bundled and registered at launch
/// (see `FontLoader.registerAll()`).
///
/// If a custom font fails to register, the helpers fall back to system
/// fonts of the same size + weight. Don't reach into `Font.custom`
/// directly anywhere outside this file.
enum DSFont {
    enum Display {
        static func xl() -> Font {
            inter(size: 32, weight: .semibold, tracking: -0.48, leading: 35.2)
        }
        static func lg() -> Font {
            inter(size: 24, weight: .semibold, tracking: -0.24, leading: 27.6)
        }
    }

    enum Body {
        static func lg() -> Font {
            inter(size: 16, weight: .medium, tracking: 0, leading: 22.4)
        }
        static func md() -> Font {
            inter(size: 14, weight: .regular, tracking: 0, leading: 20.3)
        }
        static func sm() -> Font {
            inter(size: 12, weight: .medium, tracking: 0.12, leading: 16.8)
        }
    }

    enum Mono {
        /// HUD timer, durations.
        static func timer() -> Font {
            jetBrains(size: 18, weight: .medium)
        }
        /// Diagnostics, raw IDs, debug surfaces.
        static func body() -> Font {
            jetBrains(size: 12, weight: .regular)
        }
    }

    // MARK: - Builders

    /// Inter, with system fallback. Tracking + leading are exposed for
    /// callsites that want explicit control; the public tokens use the
    /// values from the spec.
    private static func inter(
        size: CGFloat,
        weight: Font.Weight,
        tracking _: CGFloat = 0,
        leading _: CGFloat = 0
    ) -> Font {
        // Variable font shows up under the family name "Inter"; weight
        // is honored via SwiftUI's `.weight()` modifier on the returned
        // Font, NOT through the Font.custom name.
        guard NSFont(name: "Inter", size: size) != nil else {
            return Font.system(size: size, weight: weight, design: .default)
        }
        return Font.custom("Inter", size: size).weight(weight)
    }

    private static func jetBrains(size: CGFloat, weight: Font.Weight) -> Font {
        guard NSFont(name: "JetBrains Mono", size: size) != nil else {
            return Font.system(size: size, weight: weight, design: .monospaced)
        }
        return Font.custom("JetBrains Mono", size: size).weight(weight)
    }
}
