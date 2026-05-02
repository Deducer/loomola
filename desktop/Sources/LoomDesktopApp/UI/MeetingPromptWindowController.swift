import AppKit
import SwiftUI

@MainActor
final class MeetingPromptWindowController {
    private var panel: NSPanel?

    func show(
        context: MeetingContext,
        startDisabled: Bool,
        start: @escaping () -> Void,
        dismiss: @escaping () -> Void
    ) {
        let content = MeetingPromptPanelView(
            context: context,
            startDisabled: startDisabled,
            start: { [weak self] in
                self?.hide()
                start()
            },
            dismiss: { [weak self] in
                self?.hide()
                dismiss()
            }
        )
        let hostingView = NSHostingView(rootView: content)
        let size = NSSize(width: 360, height: 132)

        let panel = panel ?? NSPanel(
            contentRect: NSRect(origin: .zero, size: size),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.contentView = hostingView
        panel.setContentSize(size)
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient]
        panel.hidesOnDeactivate = false
        panel.isMovableByWindowBackground = true
        panel.setFrameOrigin(Self.topRightOrigin(for: size))
        panel.orderFrontRegardless()
        self.panel = panel
    }

    func hide() {
        panel?.orderOut(nil)
    }

    private static func topRightOrigin(for size: NSSize) -> NSPoint {
        let frame = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        return NSPoint(
            x: frame.maxX - size.width - 24,
            y: frame.maxY - size.height - 24
        )
    }
}

private struct MeetingPromptPanelView: View {
    let context: MeetingContext
    let startDisabled: Bool
    let start: () -> Void
    let dismiss: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "waveform.circle.fill")
                .font(.system(size: 28, weight: .semibold))
                .foregroundStyle(.white)
                .padding(.top, 2)

            VStack(alignment: .leading, spacing: 6) {
                Text("Meeting ready")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(.white)
                Text(context.suggestedTitle)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(.white.opacity(0.84))
                    .lineLimit(1)
                Text(context.sourceContextHint)
                    .font(.system(size: 11))
                    .foregroundStyle(.white.opacity(0.52))
                    .lineLimit(1)

                HStack(spacing: 8) {
                    Button("Start note", action: start)
                        .disabled(startDisabled)
                    Button("Not now", action: dismiss)
                        .buttonStyle(.plain)
                        .foregroundStyle(.white.opacity(0.72))
                }
                .font(.system(size: 12, weight: .semibold))
                .padding(.top, 4)
            }

            Spacer(minLength: 0)
        }
        .padding(14)
        .frame(width: 360, height: 132)
        .background(
            RoundedRectangle(cornerRadius: 14)
                .fill(Color(red: 0.12, green: 0.12, blue: 0.13).opacity(0.96))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .stroke(Color.white.opacity(0.12), lineWidth: 1)
        )
    }
}
