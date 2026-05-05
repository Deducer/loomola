import AppKit
import SwiftUI

/// Loomola color tokens. Use these everywhere instead of
/// `Color(nsColor: .windowBackgroundColor)` and friends — system
/// semantic colors don't carry brand identity.
///
/// Each token resolves to an explicit light + dark RGB pair. All values
/// come from the M3 design spec (`docs/superpowers/specs/2026-05-04-desktop-app-m3-visual-restructure-design.md`).
enum DSColor {
    enum Bg {
        /// Main window background. Warm off-white in light, near-black in dark.
        static let canvas = Color.dynamic(
            light: Color(red: 0.980, green: 0.980, blue: 0.969), // #FAFAF7
            dark: Color(red: 0.055, green: 0.059, blue: 0.071)   // #0E0F12
        )
        /// Cards, sheets — the layer above canvas.
        static let surface = Color.dynamic(
            light: Color.white,
            dark: Color(red: 0.094, green: 0.102, blue: 0.125)   // #181A20
        )
        /// Hovered cards, popovers, settings sheet — the layer above surface.
        static let surfaceRaised = Color.dynamic(
            light: Color.white,
            dark: Color(red: 0.122, green: 0.133, blue: 0.165)   // #1F222A
        )
        /// Inset wells, secondary chips, disabled-button background.
        static let subtle = Color.dynamic(
            light: Color(red: 0.949, green: 0.945, blue: 0.925), // #F2F1EC
            dark: Color(red: 0.133, green: 0.145, blue: 0.180)   // #22252E
        )
    }

    enum Text {
        static let primary = Color.dynamic(
            light: Color(red: 0.082, green: 0.086, blue: 0.102), // #15161A
            dark: Color(red: 0.957, green: 0.957, blue: 0.945)   // #F4F4F1
        )
        static let secondary = Color.dynamic(
            light: Color(red: 0.361, green: 0.369, blue: 0.400), // #5C5E66
            dark: Color(red: 0.616, green: 0.627, blue: 0.675)   // #9DA0AC
        )
        static let tertiary = Color.dynamic(
            light: Color(red: 0.541, green: 0.549, blue: 0.584), // #8A8C95
            dark: Color(red: 0.416, green: 0.427, blue: 0.471)   // #6A6D78
        )
    }

    enum Border {
        /// 1px hairlines, dividers.
        static let subtle = Color.dynamic(
            light: Color(red: 0.922, green: 0.918, blue: 0.890), // #EBEAE3
            dark: Color(red: 0.165, green: 0.176, blue: 0.216)   // #2A2D37
        )
        /// Card outlines when used (rare — most cards use shadow only).
        static let strong = Color.dynamic(
            light: Color(red: 0.835, green: 0.827, blue: 0.792), // #D5D3CA
            dark: Color(red: 0.231, green: 0.247, blue: 0.298)   // #3B3F4C
        )
    }

    enum Accent {
        /// Brand blue. Used on primary CTAs and brand moments.
        static let primary = Color.dynamic(
            light: Color(red: 0.231, green: 0.510, blue: 0.965),  // #3B82F6
            dark: Color(red: 0.361, green: 0.608, blue: 1.000)    // #5C9BFF
        )
        /// Soft hover/selected fills derived from accent.
        static let muted = Color.dynamic(
            light: Color(red: 0.231, green: 0.510, blue: 0.965).opacity(0.12),
            dark: Color(red: 0.361, green: 0.608, blue: 1.000).opacity(0.18)
        )
    }

    enum State {
        /// Live recording dot, HUD red.
        static let recording = Color(red: 0.910, green: 0.294, blue: 0.271) // #E84B45
        /// Granted, uploaded, success.
        static let success = Color.dynamic(
            light: Color(red: 0.122, green: 0.651, blue: 0.447), // #1FA672
            dark: Color(red: 0.204, green: 0.831, blue: 0.600)   // #34D399
        )
        /// Permission pending, "ask later," soft warn.
        static let warning = Color.dynamic(
            light: Color(red: 0.839, green: 0.620, blue: 0.180), // #D69E2E
            dark: Color(red: 0.965, green: 0.678, blue: 0.333)   // #F6AD55
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
