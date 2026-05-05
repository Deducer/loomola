import AppKit
import SwiftUI

@MainActor
final class AudioRecordingWindowController {
    private var panel: NSPanel?
    private let state = AudioRecordingWindowState()

    func show(
        title: String,
        startedAt: Date,
        audioLevel: Double,
        openNote: @escaping () -> Void,
        stop: @escaping () -> Void,
        discard: @escaping () -> Void
    ) {
        state.title = title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "Audio note" : title
        state.startedAt = startedAt
        state.audioLevel = audioLevel
        state.openNote = openNote
        state.stop = { [weak self] in
            self?.hide()
            stop()
        }
        state.discard = { [weak self] in
            self?.hide()
            discard()
        }

        let size = NSSize(width: 86, height: 166)

        let isNewPanel = panel == nil
        let panel = panel ?? NSPanel(
            contentRect: NSRect(origin: .zero, size: size),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        if panel.contentView == nil {
            panel.contentView = NSHostingView(rootView: AudioRecordingPanelView(state: state))
        }
        panel.setContentSize(size)
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient]
        panel.hidesOnDeactivate = false
        panel.isMovableByWindowBackground = true
        if isNewPanel {
            panel.setFrameOrigin(Self.topRightOrigin(for: size))
        }
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

@MainActor
private final class AudioRecordingWindowState: ObservableObject {
    @Published var title = "Audio note"
    @Published var startedAt = Date()
    @Published var audioLevel = 0.0
    var openNote: () -> Void = {}
    var stop: () -> Void = {}
    var discard: () -> Void = {}
}

private struct AudioRecordingPanelView: View {
    @ObservedObject var state: AudioRecordingWindowState
    @State private var hovering = false

    var body: some View {
        VStack(spacing: 9) {
            AudioLevelBars(level: state.audioLevel)
                .frame(width: 40, height: 30)
                .padding(.top, 10)

            TimelineView(.periodic(from: state.startedAt, by: 1)) { timeline in
                Text(elapsedText(now: timeline.date))
                    .font(DSFont.Mono.body())
                    .foregroundStyle(.white.opacity(0.54))
            }

            Spacer(minLength: 0)

            if hovering {
                VStack(spacing: 9) {
                    Button(action: state.stop) {
                        Image(systemName: "stop.fill")
                            .font(.system(size: 13, weight: .bold))
                            .frame(width: 34, height: 34)
                            .background(Color.white.opacity(0.14), in: Circle())
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(.white.opacity(0.88))
                    .help("Stop and upload audio note")

                    Capsule()
                        .fill(Color.white.opacity(0.2))
                        .frame(width: 28, height: 3)
                        .help("Drag to move")

                    Button(action: state.discard) {
                        Image(systemName: "trash")
                            .font(.system(size: 11, weight: .bold))
                            .frame(width: 30, height: 30)
                            .background(DSColor.State.recording.opacity(0.18), in: Circle())
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(DSColor.State.recording.opacity(0.92))
                    .help("Discard audio note")
                }
                .transition(.opacity.combined(with: .scale(scale: 0.92)))
            } else {
                LiveDots(level: state.audioLevel)
                    .transition(.opacity.combined(with: .scale(scale: 0.92)))
                    .help(state.title)
            }

            Spacer(minLength: 0)
        }
        .padding(.horizontal, 9)
        .frame(width: 86, height: 166)
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
        .onTapGesture {
            if !hovering {
                state.openNote()
            }
        }
    }

    private func elapsedText(now: Date) -> String {
        let elapsed = max(0, Int(now.timeIntervalSince(state.startedAt)))
        let minutes = elapsed / 60
        let seconds = elapsed % 60
        return String(format: "%02d:%02d", minutes, seconds)
    }
}

private struct AudioLevelBars: View {
    let level: Double

    var body: some View {
        TimelineView(.animation(minimumInterval: 0.1)) { timeline in
            HStack(alignment: .center, spacing: 3) {
                ForEach(0..<5) { index in
                    Capsule()
                        .fill(DSColor.State.success)
                        .frame(width: 4, height: barHeight(index: index, date: timeline.date))
                }
            }
        }
        .accessibilityLabel("Live audio level")
    }

    private func barHeight(index: Int, date: Date) -> CGFloat {
        let pulse = (sin(date.timeIntervalSinceReferenceDate * 8 + Double(index)) + 1) / 2
        let floor = 5.0
        let scaled = floor + min(1, max(0, level)) * (8 + pulse * 14)
        return CGFloat(scaled)
    }
}

private struct LiveDots: View {
    let level: Double

    var body: some View {
        HStack(spacing: 5) {
            ForEach(0..<3) { index in
                Circle()
                    .fill(DSColor.State.success)
                    .frame(width: dotSize(index: index), height: dotSize(index: index))
            }
        }
    }

    private func dotSize(index: Int) -> CGFloat {
        CGFloat(4 + min(1, max(0, level)) * Double(index + 1) * 1.4)
    }
}
