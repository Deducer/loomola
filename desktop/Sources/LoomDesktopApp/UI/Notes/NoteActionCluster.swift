import SwiftUI

/// Granola's top-right note actions are always visible: ⋯, folder,
/// a labelled Share pill and a Copy-link circle (parity rank 9). The
/// circles reuse the workspace's chrome buttons; this is the pill.
struct ShareChromeButton: View {
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "lock")
                .font(.system(size: 11, weight: .medium))
            Text("Share")
                .font(DSFont.Body.sm().weight(.medium))
        }
        .foregroundStyle(hovering ? DSColor.Text.primary : DSColor.Text.secondary)
        .padding(.horizontal, 12)
        .frame(height: 32)
        .background(Capsule().fill(hovering ? DSColor.Bg.subtle.opacity(0.94) : DSColor.Bg.surface.opacity(0.6)))
        .overlay { Capsule().strokeBorder(DSColor.Border.subtle.opacity(hovering ? 0.9 : 0.55), lineWidth: 1) }
        .contentShape(Capsule())
        .overlay { ActionHitArea(action: action).clipShape(Capsule()) }
        .onHover { hovering = $0 }
        .animation(LoomolaMotion.quick, value: hovering)
        .help("Share")
    }
}
