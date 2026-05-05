import SwiftUI

/// Animation primitives used app-wide. Three tiers:
///   - quick: hover, focus, color changes (~120ms ease)
///   - medium: segment slider, sheet open/close, card raise (~180ms spring)
///   - expressive: recording start "punch in" effect (~340ms spring)
///
/// Honor `accessibilityReduceMotion` by collapsing to `nil` (instant)
/// at callsite via `.animation(reduceMotion ? nil : LoomolaMotion.medium, ...)`.
enum LoomolaMotion {
    static let quick: Animation = .easeInOut(duration: 0.12)
    static let medium: Animation = .spring(duration: 0.18, bounce: 0.10)
    static let expressive: Animation = .spring(duration: 0.34, bounce: 0.22)
}
