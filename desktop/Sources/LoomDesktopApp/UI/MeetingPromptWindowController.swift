import AppKit
import SwiftUI

@MainActor
final class MeetingPromptWindowController {
    private var panel: NSPanel?

    func show(
        context: MeetingContext,
        startDisabled: Bool,
        start: @escaping () -> Void,
        join: @escaping () -> Void,
        dismiss: @escaping () -> Void
    ) {
        let content = MeetingPromptPanelView(
            context: context,
            startDisabled: startDisabled,
            start: { [weak self] in
                self?.hide()
                start()
            },
            join: join,
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
    let join: () -> Void
    let dismiss: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: DSSpacing.md) {
            Image(systemName: "waveform.circle.fill")
                .font(.system(size: 28, weight: .semibold))
                .foregroundStyle(DSColor.State.success)
                .padding(.top, 2)

            VStack(alignment: .leading, spacing: DSSpacing.xs) {
                Text("Meeting ready")
                    .font(DSFont.Body.lg())
                    .foregroundStyle(.white)
                Text(context.suggestedTitle)
                    .font(DSFont.Body.md())
                    .foregroundStyle(.white.opacity(0.84))
                    .lineLimit(1)
                Text(context.sourceContextHint)
                    .font(DSFont.Body.sm())
                    .foregroundStyle(.white.opacity(0.52))
                    .lineLimit(1)

                HStack(spacing: DSSpacing.sm) {
                    MeetingPromptTextAction("Start note", isProminent: true, isEnabled: !startDisabled) {
                        start()
                    }
                    if context.joinURL != nil || context.bundleIdentifier != nil {
                        MeetingPromptTextAction(joinLabel, action: join)
                            .foregroundStyle(.white.opacity(0.92))
                    }
                    MeetingPromptTextAction("Not now", action: dismiss)
                        .foregroundStyle(.white.opacity(0.72))
                }
                .font(DSFont.Body.sm())
                .padding(.top, DSSpacing.xs)
            }

            Spacer(minLength: 0)
        }
        .padding(DSSpacing.lg)
        .frame(width: 360, height: 132)
        .background(
            RoundedRectangle(cornerRadius: DSRadius.lg)
                .fill(Color(red: 0.12, green: 0.12, blue: 0.13).opacity(0.96))
        )
        .overlay(
            RoundedRectangle(cornerRadius: DSRadius.lg)
                .stroke(Color.white.opacity(0.12), lineWidth: 1)
        )
    }

    private var joinLabel: String {
        switch context.detectedApp {
        case "google-meet", "meet": return "Open Meet"
        case "zoom": return "Open Zoom"
        case "teams": return "Open Teams"
        case "webex": return "Open Webex"
        default: return "Open meeting"
        }
    }
}

private struct MeetingPromptTextAction: View {
    let title: String
    let isProminent: Bool
    let isEnabled: Bool
    let action: () -> Void

    init(
        _ title: String,
        isProminent: Bool = false,
        isEnabled: Bool = true,
        action: @escaping () -> Void
    ) {
        self.title = title
        self.isProminent = isProminent
        self.isEnabled = isEnabled
        self.action = action
    }

    var body: some View {
        Text(title)
            .font(DSFont.Body.sm())
            .foregroundStyle(isProminent ? Color.black : Color.white.opacity(0.86))
            .padding(.horizontal, DSSpacing.sm)
            .padding(.vertical, DSSpacing.xs)
            .background(background)
            .opacity(isEnabled ? 1.0 : 0.45)
            .contentShape(Rectangle())
            .overlay { ActionHitArea(isEnabled: isEnabled, action: action) }
    }

    @ViewBuilder
    private var background: some View {
        if isProminent {
            Capsule().fill(Color.white.opacity(0.94))
        }
    }
}
