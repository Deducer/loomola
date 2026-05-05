import SwiftUI

/// Three layered shadow tiers. Never use SwiftUI's default `.shadow`
/// directly — use `.dsShadow(.subtle)` etc. so the look is consistent
/// app-wide.
enum DSShadowKind {
    case subtle
    case raised
    /// Brand shadow uses a tinted color (typically `DSColor.Accent.primary`)
    /// for hover states on primary CTAs.
    case brand(color: Color)
}

extension View {
    /// Apply a Loomola design-system shadow.
    @ViewBuilder
    func dsShadow(_ kind: DSShadowKind) -> some View {
        switch kind {
        case .subtle:
            // Two-stop subtle drop. Matches the spec values.
            self
                .shadow(color: Color.black.opacity(0.04), radius: 2, x: 0, y: 1)
                .shadow(color: Color.black.opacity(0.06), radius: 1, x: 0, y: 0)
        case .raised:
            self
                .shadow(color: Color.black.opacity(0.06), radius: 12, x: 0, y: 4)
                .shadow(color: Color.black.opacity(0.04), radius: 2, x: 0, y: 1)
        case .brand(let color):
            self.shadow(color: color.opacity(0.16), radius: 20, x: 0, y: 4)
        }
    }
}
