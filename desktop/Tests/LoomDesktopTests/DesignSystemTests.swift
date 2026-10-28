import AppKit
import SwiftUI
import XCTest
@testable import LoomDesktopApp

/// Smoke tests for the M3 design system tokens. Each token must
/// resolve to a non-nil value and (for color) differ between light
/// and dark schemes — protects against accidental "both schemes
/// resolve to the same color" regressions.
final class DesignSystemTests: XCTestCase {
    func testColorTokensResolveDifferentlyInLightAndDark() {
        // Build NSColor representations of canvas in each scheme and
        // compare. If light and dark resolve to identical RGB, the
        // dynamic provider is broken.
        let canvasLight = nsColor(for: DSColor.Bg.canvas, appearance: .aqua)
        let canvasDark = nsColor(for: DSColor.Bg.canvas, appearance: .darkAqua)
        XCTAssertNotEqual(canvasLight, canvasDark, "DSColor.Bg.canvas must differ light vs dark")

        let textLight = nsColor(for: DSColor.Text.primary, appearance: .aqua)
        let textDark = nsColor(for: DSColor.Text.primary, appearance: .darkAqua)
        XCTAssertNotEqual(textLight, textDark, "DSColor.Text.primary must differ light vs dark")

        let surfaceLight = nsColor(for: DSColor.Bg.surface, appearance: .aqua)
        let surfaceDark = nsColor(for: DSColor.Bg.surface, appearance: .darkAqua)
        XCTAssertNotEqual(surfaceLight, surfaceDark, "DSColor.Bg.surface must differ light vs dark")
    }

    func testStateRecordingIsTheSameInBothSchemes() {
        // Recording red is intentionally identical in light + dark —
        // the state is the state, regardless of theme.
        let light = nsColor(for: DSColor.State.recording, appearance: .aqua)
        let dark = nsColor(for: DSColor.State.recording, appearance: .darkAqua)
        XCTAssertEqual(light, dark, "Recording red is theme-invariant by design")
    }

    func testSpacingScaleIsMonotonic() {
        XCTAssertLessThan(DSSpacing.xs, DSSpacing.sm)
        XCTAssertLessThan(DSSpacing.sm, DSSpacing.md)
        XCTAssertLessThan(DSSpacing.md, DSSpacing.lg)
        XCTAssertLessThan(DSSpacing.lg, DSSpacing.xl)
        XCTAssertLessThan(DSSpacing.xl, DSSpacing.xxl)
        XCTAssertLessThan(DSSpacing.xxl, DSSpacing.xxxl)
    }

    func testRadiusScaleIsMonotonic() {
        XCTAssertLessThan(DSRadius.sm, DSRadius.md)
        XCTAssertLessThan(DSRadius.md, DSRadius.lg)
        XCTAssertLessThan(DSRadius.lg, DSRadius.xl)
        // pill is a sentinel; only assert it's distinguishably larger
        XCTAssertGreaterThan(DSRadius.pill, DSRadius.xl * 100)
    }

    func testGranolaDarkNeutrals() {
        // Parity rank 1: the dark scale is Granola's warm charcoal, the
        // light scale its docs palette. Pinned so a "tidy-up" can't
        // drift the app back to the cool near-black.
        XCTAssertEqual(DSColor.hex(DSColor.Bg.canvas, dark: true), "#252525")
        XCTAssertEqual(DSColor.hex(DSColor.Bg.sidebar, dark: true), "#1E1E1E")
        XCTAssertEqual(DSColor.hex(DSColor.Bg.surface, dark: true), "#2F2F2F")
        XCTAssertEqual(DSColor.hex(DSColor.Text.primary, dark: true), "#E8E8E6")
        XCTAssertEqual(DSColor.hex(DSColor.Text.secondary, dark: true), "#C8C8C6")
        XCTAssertEqual(DSColor.hex(DSColor.Text.tertiary, dark: true), "#8E8E8C")
        XCTAssertEqual(DSColor.hex(DSColor.Accent.ai, dark: true), "#B2C248")
        XCTAssertEqual(DSColor.hex(DSColor.Accent.ai, dark: false), "#788C15")
        XCTAssertEqual(DSColor.hex(DSColor.Bg.canvas, dark: false), "#F2F2EC")
    }

    func testFontTokensReturnNonOptionalFonts() {
        // Fonts should always resolve, either from the bundled custom
        // family or the system fallback. We can't easily diff Font
        // instances; this is a compile-only assertion that the API
        // surface exists.
        _ = DSFont.Display.xl()
        _ = DSFont.Display.lg()
        _ = DSFont.Body.lg()
        _ = DSFont.Body.md()
        _ = DSFont.Body.sm()
        _ = DSFont.Mono.timer()
        _ = DSFont.Mono.body()
    }

    // MARK: - Helpers

    /// Resolve a SwiftUI `Color` to an `NSColor` under a specific
    /// appearance so we can compare light vs dark values.
    private func nsColor(for color: Color, appearance: NSAppearance.Name) -> NSColor {
        let nsColor = NSColor(color)
        var resolved: NSColor = nsColor
        let app = NSAppearance(named: appearance)!
        app.performAsCurrentDrawingAppearance {
            resolved = nsColor.usingColorSpace(.sRGB) ?? nsColor
        }
        return resolved
    }
}
