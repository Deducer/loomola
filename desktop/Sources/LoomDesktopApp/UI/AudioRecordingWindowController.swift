import AppKit
import SwiftUI

@MainActor
final class AudioRecordingWindowController {
    private var panel: NSPanel?

    func show(
        title: String,
        startedAt: Date,
        stop: @escaping () -> Void,
        discard: @escaping () -> Void
    ) {
        let content = AudioRecordingPanelView(
            title: title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "Audio note" : title,
            startedAt: startedAt,
            stop: { [weak self] in
                self?.hide()
                stop()
            },
            discard: { [weak self] in
                self?.hide()
                discard()
            }
        )
        let hostingView = NSHostingView(rootView: content)
        let size = NSSize(width: 330, height: 116)

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

private struct AudioRecordingPanelView: View {
    let title: String
    let startedAt: Date
    let stop: () -> Void
    let discard: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            RecordingPulse()
                .padding(.top, 4)

            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .firstTextBaseline) {
                    Text("Recording")
                        .font(.system(size: 15, weight: .semibold))
                    Spacer()
                    TimelineView(.periodic(from: startedAt, by: 1)) { timeline in
                        Text(elapsedText(now: timeline.date))
                            .font(.system(size: 13, weight: .semibold, design: .monospaced))
                    }
                }
                .foregroundStyle(.white)

                Text(title)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(.white.opacity(0.68))
                    .lineLimit(1)

                HStack(spacing: 8) {
                    Button("Stop", action: stop)
                    Button("Discard", action: discard)
                        .buttonStyle(.plain)
                        .foregroundStyle(.white.opacity(0.72))
                }
                .font(.system(size: 12, weight: .semibold))
                .padding(.top, 4)
            }
        }
        .padding(14)
        .frame(width: 330, height: 116)
        .background(
            RoundedRectangle(cornerRadius: 14)
                .fill(Color(red: 0.11, green: 0.11, blue: 0.12).opacity(0.96))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .stroke(Color.white.opacity(0.12), lineWidth: 1)
        )
    }

    private func elapsedText(now: Date) -> String {
        let elapsed = max(0, Int(now.timeIntervalSince(startedAt)))
        let minutes = elapsed / 60
        let seconds = elapsed % 60
        return String(format: "%02d:%02d", minutes, seconds)
    }
}

private struct RecordingPulse: View {
    var body: some View {
        Circle()
            .fill(Color(red: 0.18, green: 0.82, blue: 0.42))
            .frame(width: 14, height: 14)
            .overlay(
                Circle()
                    .stroke(Color.white.opacity(0.26), lineWidth: 2)
                    .frame(width: 24, height: 24)
            )
    }
}
