import AppKit
import SwiftUI

/// SwiftUI hook that hands the hosting NSWindow to a configuration
/// closure. Used to customize the main app window's title-bar
/// height so the macOS traffic lights AND our home/⋯ row both get
/// real breathing room above them — Granola pattern.
///
/// Why a runtime customization? `.windowStyle(.hiddenTitleBar)`
/// gives a 28pt title bar with traffic lights at y~12 — visually
/// cramped against the top edge. Adding an empty NSToolbar with
/// `.unified` style grows the title bar area to ~52pt so the
/// traffic lights center vertically with ~20pt of clear space
/// above them.
struct WindowAccessor: NSViewRepresentable {
    let onWindow: (NSWindow) -> Void

    func makeNSView(context: Context) -> NSView {
        let view = NSView()
        DispatchQueue.main.async {
            if let window = view.window {
                onWindow(window)
            }
        }
        return view
    }

    func updateNSView(_ nsView: NSView, context: Context) {}
}

@MainActor
enum WindowChrome {
    /// Make the title bar tall (~52pt) with a unified toolbar so
    /// traffic lights have visual room above them. Idempotent —
    /// safe to call on every appear.
    static func applyTallTitleBar(to window: NSWindow) {
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        if window.toolbar == nil {
            let toolbar = NSToolbar(identifier: "loomola-main-toolbar")
            toolbar.showsBaselineSeparator = false
            toolbar.displayMode = .iconOnly
            window.toolbar = toolbar
        }
        window.toolbarStyle = .unified
    }

    /// In full screen a unified toolbar is what macOS reveals with the
    /// menu bar, and the title bar that carries the traffic lights
    /// stays hidden. Drop the (empty, height-only) toolbar while full
    /// screen so the revealed strip is the title bar with its close /
    /// minimise / zoom buttons; put it back on exit.
    static func updateForFullScreen(_ window: NSWindow) {
        if window.styleMask.contains(.fullScreen) {
            window.toolbar = nil
        } else {
            applyTallTitleBar(to: window)
        }
    }
}

enum WindowChromeLayout {
    static let topPadding: CGFloat = DSSpacing.md
    static let barHeight: CGFloat = 44
    static let homeLeadingPadding: CGFloat = 142
    static let noteLeadingPadding: CGFloat = 112
    static let trailingPadding: CGFloat = DSSpacing.lg
    static let homeContentTopPaddingNormal: CGFloat = 72
    static let homeContentTopPaddingExpanded: CGFloat = 64
    static let noteContentTopPadding: CGFloat = 88
    /// Granola's rail is 192pt; a little wider here so folder names
    /// with emoji don't truncate.
    static let sidebarWidth: CGFloat = 208
    /// Readable column for the notes-side home content (Granola ~620pt).
    static let notesHomeMaxWidth: CGFloat = 640
}

extension View {
    /// Keep custom Loomola chrome aligned with the macOS traffic
    /// lights while the titlebar is visible, but fall back to the
    /// top safe area in fullscreen where macOS hides that strip.
    @ViewBuilder
    func loomolaTitlebarPinned(_ isPinned: Bool) -> some View {
        if isPinned {
            self.ignoresSafeArea(.container, edges: .top)
        } else {
            self
        }
    }
}
