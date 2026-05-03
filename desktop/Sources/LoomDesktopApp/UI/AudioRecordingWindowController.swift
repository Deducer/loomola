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
        let size = NSSize(width: 74, height: 138)

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
    @State private var hovering = false

    var body: some View {
        VStack(spacing: 9) {
            Image(systemName: "waveform.circle.fill")
                .font(.system(size: 27, weight: .semibold))
                .symbolRenderingMode(.hierarchical)
                .foregroundStyle(.white.opacity(0.84))
                .padding(.top, 10)

            TimelineView(.periodic(from: startedAt, by: 1)) { timeline in
                Text(elapsedText(now: timeline.date))
                    .font(.system(size: 10, weight: .semibold, design: .monospaced))
                    .foregroundStyle(.white.opacity(0.54))
            }

            Spacer(minLength: 0)

            if hovering {
                HStack(spacing: 7) {
                    Button(action: stop) {
                        Image(systemName: "stop.fill")
                            .font(.system(size: 10, weight: .bold))
                    }
                    .help("Stop and upload audio note")

                    Button(action: discard) {
                        Image(systemName: "trash")
                            .font(.system(size: 10, weight: .bold))
                    }
                    .help("Discard audio note")
                }
                .buttonStyle(.plain)
                .foregroundStyle(.white.opacity(0.8))
                .transition(.opacity.combined(with: .scale(scale: 0.92)))
            } else {
                LiveDots()
                    .transition(.opacity.combined(with: .scale(scale: 0.92)))
                    .help(title)
            }

            Spacer(minLength: 0)
        }
        .padding(.horizontal, 9)
        .frame(width: 74, height: 138)
        .background(
            Capsule()
                .fill(Color(red: 0.12, green: 0.12, blue: 0.13).opacity(0.94))
        )
        .overlay(
            Capsule()
                .stroke(Color.white.opacity(0.12), lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.26), radius: 18, x: 0, y: 10)
        .onHover { isHovering in
            withAnimation(.easeOut(duration: 0.14)) {
                hovering = isHovering
            }
        }
    }

    private func elapsedText(now: Date) -> String {
        let elapsed = max(0, Int(now.timeIntervalSince(startedAt)))
        let minutes = elapsed / 60
        let seconds = elapsed % 60
        return String(format: "%02d:%02d", minutes, seconds)
    }
}

private struct LiveDots: View {
    var body: some View {
        HStack(spacing: 5) {
            ForEach(0..<3) { _ in
                Circle()
                    .fill(Color(red: 0.48, green: 0.9, blue: 0.08))
                    .frame(width: 4, height: 4)
            }
        }
    }
}
