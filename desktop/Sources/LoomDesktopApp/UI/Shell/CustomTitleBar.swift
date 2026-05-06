import AppKit
import SwiftUI

/// Custom 40pt title bar that replaces the system title strip.
/// Holds:
///   - traffic-light spacer (78pt to clear the macOS lights at standard inset)
///   - Loomola logo mark + wordmark, centered-left
///   - settings gear (right)
///   - account avatar (far right; renders the user's first email letter)
///
/// `NSWindow.titlebarAppearsTransparent` + `titleVisibility = .hidden`
/// applied at app init (see LoomDesktopApp / WindowDecorator) so the
/// system title strip doesn't double up.
struct CustomTitleBar: View {
    let userInitial: Character?
    let sidebarOpen: Bool
    let onToggleSidebar: () -> Void
    let onSettings: () -> Void
    let onAccount: () -> Void

    var body: some View {
        HStack(spacing: 0) {
            // Reserve space for the macOS traffic lights. They sit at
            // ~12pt from the left edge with ~14pt diameter; 78pt total
            // clears them comfortably across all macOS versions.
            Spacer().frame(width: 78)

            // Sidebar toggle — Granola's left-of-wordmark button.
            // Filled when open, outlined when closed. ⌘S elsewhere.
            IconButton(
                icon: sidebarOpen ? "sidebar.left" : "sidebar.left",
                size: 26,
                action: onToggleSidebar
            )
            .help(sidebarOpen ? "Close sidebar (⌘S)" : "Open sidebar (⌘S)")
            .padding(.trailing, DSSpacing.sm)

            HStack(spacing: DSSpacing.sm) {
                BrandLogoMark(size: 22)
                Text("Loomola")
                    .font(DSFont.Body.lg())
                    .foregroundStyle(DSColor.Text.primary)
            }

            Spacer()

            HStack(spacing: DSSpacing.sm) {
                IconButton(icon: "gearshape", size: 30, action: onSettings)
                IconButton(
                    text: userInitial.map { String($0).uppercased() } ?? "?",
                    size: 30,
                    action: onAccount
                )
            }
            .padding(.trailing, DSSpacing.lg)
        }
        .frame(height: 52)
        .frame(maxWidth: .infinity)
        .background(DSColor.Bg.canvas)
    }
}

/// Brand logo mark — wraps the bundled `loomola-logo-mark` PNG.
/// Falls back to a gradient placeholder so the app never appears
/// chrome-less if the asset is missing.
struct BrandLogoMark: View {
    let size: CGFloat

    var body: some View {
        if let image = NSImage(named: "loomola-logo-mark") {
            Image(nsImage: image)
                .resizable()
                .interpolation(.high)
                .aspectRatio(contentMode: .fit)
                .frame(width: size, height: size)
        } else {
            ZStack {
                RoundedRectangle(cornerRadius: size * 0.24)
                    .fill(LinearGradient(
                        colors: [DSColor.Accent.primary, DSColor.State.success],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    ))
                Image(systemName: "waveform.and.video")
                    .font(.system(size: size * 0.45, weight: .semibold))
                    .foregroundStyle(.white)
            }
            .frame(width: size, height: size)
        }
    }
}
