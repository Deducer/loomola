import AppKit

@MainActor
final class BubbleOverlayWindowController {
    private var panel: NSPanel?

    func showPlaceholder() {
        if let panel {
            panel.makeKeyAndOrderFront(nil)
            return
        }

        let contentView = BubblePlaceholderView(frame: NSRect(x: 0, y: 0, width: 180, height: 180))
        let panel = NSPanel(
            contentRect: NSRect(x: 320, y: 320, width: 180, height: 180),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.contentView = contentView
        panel.isMovableByWindowBackground = true
        panel.orderFrontRegardless()
        self.panel = panel
    }

    func hide() {
        panel?.orderOut(nil)
    }

    var currentFrame: CGRect? {
        panel?.frame
    }
}

private final class BubblePlaceholderView: NSView {
    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        layer?.cornerRadius = frameRect.width / 2
        layer?.masksToBounds = true
        layer?.backgroundColor = NSColor.systemPurple.withAlphaComponent(0.82).cgColor
    }

    required init?(coder: NSCoder) {
        nil
    }

    override func draw(_ dirtyRect: NSRect) {
        NSColor.white.setFill()
        let text = "Camera"
        let attrs: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: 18, weight: .semibold),
            .foregroundColor: NSColor.white
        ]
        let size = text.size(withAttributes: attrs)
        text.draw(
            at: CGPoint(x: (bounds.width - size.width) / 2, y: (bounds.height - size.height) / 2),
            withAttributes: attrs
        )
    }
}
