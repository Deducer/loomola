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
        let size = NSSize(width: 426, height: 98)

        let panel = panel ?? NSPanel(
            contentRect: NSRect(origin: .zero, size: size),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.contentView = NSHostingView(rootView: content)
        panel.setContentSize(size)
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.level = .popUpMenu
        panel.collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary, .transient]
        panel.hidesOnDeactivate = false
        panel.isMovableByWindowBackground = false
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
            x: frame.maxX - size.width - 18,
            y: frame.maxY - size.height - 18
        )
    }
}

private struct MeetingPromptPanelView: View {
    let context: MeetingContext
    let startDisabled: Bool
    let start: () -> Void
    let join: () -> Void
    let dismiss: () -> Void

    @State private var hovering = false
    @State private var menuOpen = false

    var body: some View {
        ZStack(alignment: .topLeading) {
            promptCard
                .offset(x: 20, y: 12)

            closeButton
                .opacity(hovering ? 1 : 0)
                .scaleEffect(hovering ? 1 : 0.92)
                .animation(LoomolaMotion.quick, value: hovering)
        }
        .frame(width: 426, height: 98, alignment: .topLeading)
        .onHover { hovering = $0 }
    }

    private var promptCard: some View {
        HStack(spacing: 0) {
            HStack(alignment: .center, spacing: 20) {
                RoundedRectangle(cornerRadius: 4)
                    .fill(Color(red: 0.55, green: 0.91, blue: 0.94))
                    .frame(width: 6, height: 52)

                VStack(alignment: .leading, spacing: 4) {
                    Text(context.suggestedTitle)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.94))
                        .lineLimit(1)
                        .truncationMode(.tail)
                    Text(subtitle)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(.white.opacity(0.58))
                        .lineLimit(1)
                        .truncationMode(.tail)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.leading, 24)

            primaryAction
                .padding(.trailing, 16)
        }
        .frame(width: 406, height: 76)
        .background(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .fill(Color(red: 0.14, green: 0.14, blue: 0.14).opacity(0.96))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .stroke(Color.white.opacity(0.18), lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.34), radius: 18, x: 0, y: 10)
    }

    private var primaryAction: some View {
        HStack(spacing: 0) {
            HStack(spacing: 10) {
                MeetingAppIcon(app: context.detectedApp)
                    .frame(width: 30, height: 30)

                VStack(alignment: .leading, spacing: 1) {
                    Text(canOpenMeeting ? "Join Meeting" : "Open Loomola")
                        .font(.system(size: 13.5, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.95))
                        .lineLimit(1)
                    Text(canOpenMeeting ? "& open Loomola" : "start note")
                        .font(.system(size: 12.5, weight: .medium))
                        .foregroundStyle(.white.opacity(0.58))
                        .lineLimit(1)
                }
            }
            .frame(width: 136, height: 48, alignment: .leading)
            .padding(.leading, 14)
            .contentShape(Rectangle())
            .overlay {
                ActionHitArea(isEnabled: primaryEnabled) {
                    joinAndStart()
                }
            }
            .opacity(primaryEnabled ? 1 : 0.48)

            Rectangle()
                .fill(Color.white.opacity(0.12))
                .frame(width: 1, height: 48)

            Image(systemName: "chevron.down")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(.white.opacity(0.88))
                .frame(width: 42, height: 48)
                .contentShape(Rectangle())
                .overlay {
                    ActionHitArea {
                        menuOpen.toggle()
                    }
                }
                .popover(isPresented: $menuOpen, arrowEdge: .top) {
                    MeetingPromptMenu(
                        canOpenMeeting: canOpenMeeting,
                        canStartNote: !startDisabled,
                        openMeeting: {
                            join()
                            menuOpen = false
                        },
                        startNote: {
                            start()
                            menuOpen = false
                        },
                        dismiss: {
                            dismiss()
                            menuOpen = false
                        }
                    )
                }
        }
        .frame(width: 194, height: 48)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(Color.white.opacity(0.045))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(Color.white.opacity(0.16), lineWidth: 1)
        )
    }

    private var closeButton: some View {
        ZStack {
            Circle()
                .fill(Color(red: 0.20, green: 0.20, blue: 0.20).opacity(0.98))
            Image(systemName: "xmark")
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(.white.opacity(0.92))
        }
        .frame(width: 34, height: 34)
        .shadow(color: .black.opacity(0.26), radius: 8, x: 0, y: 4)
        .overlay {
            ActionHitArea(action: dismiss)
                .clipShape(Circle())
        }
        .help("Dismiss")
    }

    private var canOpenMeeting: Bool {
        context.joinURL != nil || context.bundleIdentifier != nil
    }

    private var primaryEnabled: Bool {
        canOpenMeeting || !startDisabled
    }

    private var subtitle: String {
        let source = context.sourceContextHint.trimmingCharacters(in: .whitespacesAndNewlines)
        if source.isEmpty {
            return "Detected now"
        }
        if source.count <= 38 {
            return source
        }
        return "Detected now"
    }

    private func joinAndStart() {
        guard primaryEnabled else { return }
        if canOpenMeeting {
            join()
        }
        if !startDisabled {
            start()
        }
    }
}

private struct MeetingAppIcon: View {
    let app: String

    var body: some View {
        switch app {
        case "google-meet", "meet":
            GoogleMeetMark()
        case "zoom":
            Image(systemName: "video.fill")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 30, height: 30)
                .background(Circle().fill(Color(red: 0.20, green: 0.45, blue: 0.96)))
        case "teams":
            Image(systemName: "person.2.fill")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 30, height: 30)
                .background(RoundedRectangle(cornerRadius: 8).fill(Color(red: 0.36, green: 0.33, blue: 0.86)))
        default:
            Image(systemName: "video.bubble.left.fill")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 30, height: 30)
                .background(RoundedRectangle(cornerRadius: 8).fill(DSColor.Accent.primary))
        }
    }
}

private struct GoogleMeetMark: View {
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 7)
                .fill(Color.white.opacity(0.10))
            ZStack(alignment: .leading) {
                Rectangle()
                    .fill(Color(red: 0.10, green: 0.43, blue: 0.94))
                    .frame(width: 10, height: 20)
                    .offset(x: 0, y: 5)
                Rectangle()
                    .fill(Color(red: 0.05, green: 0.62, blue: 0.35))
                    .frame(width: 18, height: 20)
                    .offset(x: 9, y: 5)
                Rectangle()
                    .fill(Color(red: 0.98, green: 0.74, blue: 0.05))
                    .frame(width: 20, height: 10)
                    .offset(x: 0, y: -5)
                Rectangle()
                    .fill(Color(red: 0.93, green: 0.26, blue: 0.21))
                    .frame(width: 10, height: 10)
                    .offset(x: 0, y: -5)
                Path { path in
                    path.move(to: CGPoint(x: 24, y: 9))
                    path.addLine(to: CGPoint(x: 30, y: 5))
                    path.addLine(to: CGPoint(x: 30, y: 25))
                    path.addLine(to: CGPoint(x: 24, y: 21))
                    path.closeSubpath()
                }
                .fill(Color(red: 0.09, green: 0.58, blue: 0.32))
            }
            .frame(width: 30, height: 30)
        }
    }
}

private struct MeetingPromptMenu: View {
    let canOpenMeeting: Bool
    let canStartNote: Bool
    let openMeeting: () -> Void
    let startNote: () -> Void
    let dismiss: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            MeetingPromptMenuRow("Open meeting only", isEnabled: canOpenMeeting, action: openMeeting)
            MeetingPromptMenuRow("Start note only", isEnabled: canStartNote, action: startNote)
            Divider()
            MeetingPromptMenuRow("Dismiss", action: dismiss)
        }
        .padding(.vertical, 6)
        .frame(width: 180)
        .background(DSColor.Bg.surfaceRaised)
    }
}

private struct MeetingPromptMenuRow: View {
    let title: String
    let isEnabled: Bool
    let action: () -> Void

    init(_ title: String, isEnabled: Bool = true, action: @escaping () -> Void) {
        self.title = title
        self.isEnabled = isEnabled
        self.action = action
    }

    var body: some View {
        Text(title)
            .font(DSFont.Body.sm())
            .foregroundStyle(isEnabled ? DSColor.Text.primary : DSColor.Text.tertiary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .contentShape(Rectangle())
            .overlay { ActionHitArea(isEnabled: isEnabled, action: action) }
    }
}
