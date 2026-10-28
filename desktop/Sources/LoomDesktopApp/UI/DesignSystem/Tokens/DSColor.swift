import AppKit
import SwiftUI

/// Loomola color tokens. Use these everywhere instead of
/// `Color(nsColor: .windowBackgroundColor)` and friends — system
/// semantic colors don't carry brand identity.
///
/// Each token resolves to an explicit light + dark RGB pair. The dark
/// values follow Granola's warm charcoal scale (parity audit,
/// `docs/superpowers/specs/2026-10-28-granola-pixel-parity-audit.md`,
/// rank 1); the light values come from the same family as Granola's
/// docs palette (#F2F2EC background).
enum DSColor {
    enum Bg {
        /// Main window background. Warm off-white in light, warm charcoal in dark.
        static let canvas = Color.dynamic(
            light: Color(hex: 0xF2F2EC),
            dark: Color(hex: 0x252525)
        )
        /// The sidebar rail. One step darker than the canvas.
        static let sidebar = Color.dynamic(
            light: Color(hex: 0xEAEAE3),
            dark: Color(hex: 0x1E1E1E)
        )
        /// Cards, pills, transcript bubbles — the layer above canvas.
        static let surface = Color.dynamic(
            light: Color.white,
            dark: Color(hex: 0x2F2F2F)
        )
        /// Hovered cards, popovers, menus — the layer above surface.
        static let surfaceRaised = Color.dynamic(
            light: Color.white,
            dark: Color(hex: 0x363635)
        )
        /// Inset wells, secondary chips, disabled-button background.
        static let subtle = Color.dynamic(
            light: Color(hex: 0xE6E6DF),
            dark: Color(hex: 0x2A2A2A)
        )
    }

    enum Text {
        static let primary = Color.dynamic(
            light: Color(hex: 0x1F1F1D),
            dark: Color(hex: 0xE8E8E6)
        )
        static let secondary = Color.dynamic(
            light: Color(hex: 0x4A4A47),
            dark: Color(hex: 0xC8C8C6)
        )
        static let tertiary = Color.dynamic(
            light: Color(hex: 0x7A7A76),
            dark: Color(hex: 0x8E8E8C)
        )
    }

    enum Border {
        /// 1px hairlines, dividers.
        static let subtle = Color.dynamic(
            light: Color(hex: 0xE3E3DC),
            dark: Color(hex: 0x3A3A3A)
        )
        /// Card outlines when used (rare — most cards use shadow only).
        static let strong = Color.dynamic(
            light: Color(hex: 0xCFCFC6),
            dark: Color(hex: 0x484848)
        )
    }

    enum Accent {
        /// Brand blue. Primary CTAs on the video product and brand moments.
        static let primary = Color.dynamic(
            light: Color(hex: 0x3B82F6),
            dark: Color(hex: 0x5C9BFF)
        )
        /// Soft hover/selected fills derived from accent.
        static let muted = Color.dynamic(
            light: Color(hex: 0x3B82F6).opacity(0.12),
            dark: Color(hex: 0x5C9BFF).opacity(0.18)
        )
        /// Lime for AI actions: Generate notes, Enhanced, live-transcript
        /// dots. Granola's "oats green".
        static let ai = Color.dynamic(
            light: Color(hex: 0x788C15),
            dark: Color(hex: 0xB2C248)
        )
        /// Soft fill behind lime-accented chips.
        static let aiMuted = Color.dynamic(
            light: Color(hex: 0x788C15).opacity(0.14),
            dark: Color(hex: 0xB2C248).opacity(0.16)
        )
        /// Calendar event bars in the Coming up card.
        static let calendar = Color(hex: 0x8B5CF6)
    }

    enum State {
        /// Live recording dot, HUD red.
        static let recording = Color(red: 0.910, green: 0.294, blue: 0.271) // #E84B45
        /// Granted, uploaded, success.
        static let success = Color.dynamic(
            light: Color(hex: 0x1FA672),
            dark: Color(hex: 0x34D399)
        )
        /// Permission pending, "ask later," soft warn.
        static let warning = Color.dynamic(
            light: Color(hex: 0xD69E2E),
            dark: Color(hex: 0xF6AD55)
        )
        /// Destructive actions — Delete, Discard, irreversible
        /// confirms. Distinct from `recording` (which is the live
        /// red HUD dot) so a refactor to either doesn't drag the
        /// other along.
        static let danger = Color.dynamic(
            light: Color(hex: 0xD83838),
            dark: Color(hex: 0xF66767)
        )
    }

    /// Resolve a token under one appearance and return it as `#RRGGBB`
    /// (sRGB, uppercase). Used by the design-system tests to pin the
    /// Granola values; cheap enough for diagnostics too.
    static func hex(_ color: Color, dark: Bool) -> String {
        let appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        var resolved = NSColor(color)
        appearance?.performAsCurrentDrawingAppearance {
            resolved = NSColor(color).usingColorSpace(.sRGB) ?? NSColor(color)
        }
        let r = Int((resolved.redComponent * 255).rounded())
        let g = Int((resolved.greenComponent * 255).rounded())
        let b = Int((resolved.blueComponent * 255).rounded())
        return String(format: "#%02X%02X%02X", r, g, b)
    }
}

extension Color {
    /// `Color(hex: 0x252525)` — sRGB, opaque.
    init(hex: UInt32) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: 1
        )
    }
}

private extension Color {
    /// Build a Color that resolves to `light` in Aqua and `dark` in
    /// DarkAqua. Pulls through `NSColor`'s dynamic-provider initializer
    /// so it honors the user's system appearance + per-window override.
    static func dynamic(light: Color, dark: Color) -> Color {
        Color(NSColor(name: nil) { appearance in
            let isDark = appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
            return NSColor(isDark ? dark : light)
        })
    }
}
