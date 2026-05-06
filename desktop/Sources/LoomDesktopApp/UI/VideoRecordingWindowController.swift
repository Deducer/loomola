import AppKit
import SwiftUI

/// Floating HUD shown during a composite video recording. Lives top-
/// center of the screen by default; user can drag. Mirrors
/// `AudioRecordingWindowController`'s pattern but in a horizontal
/// pill optimized for "you're recording right now" feedback:
/// recording dot + elapsed timer + mic meter + stop + discard.
///
/// `sharingType = .none` keeps the HUD out of the captured screen so
/// it doesn't appear in the final MP4. Same trick the bubble overlay
/// uses for its panel.
@MainActor
final class VideoRecordingWindowController {
    private var panel: NSPanel?
    private let state = VideoRecordingWindowState()

    func show(
        startedAt: Date,
        audioLevel: Double,
        stop: @escaping () -> Void,
        discard: @escaping () -> Void
    ) {
        state.startedAt = startedAt
        state.audioLevel = audioLevel
        state.stop = { [weak self] in
            self?.hide()
            stop()
        }
        state.discard = { [weak self] in
            self?.hide()
            discard()
        }

        let size = NSSize(width: 280, height: 56)
        let isNewPanel = panel == nil
        let panel = panel ?? NSPanel(
            contentRect: NSRect(origin: .zero, size: size),
            styleMask: [.borderless, .nonactivatingPanel, .hudWindow],
            backing: .buffered,
            defer: false
        )
        if panel.contentView == nil {
            panel.contentView = NSHostingView(rootView: VideoRecordingPanelView(state: state))
        }
        panel.setContentSize(size)
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.level = .popUpMenu
        panel.collectionBehavior = [
            .canJoinAllSpaces,
            .fullScreenAuxiliary,
            .transient,
            .stationary,
            .ignoresCycle,
        ]
        panel.hidesOnDeactivate = false
        panel.isMovableByWindowBackground = true
        // Hide from the screen capture so the HUD doesn't show up in
        // the recorded MP4. The compositor renders the bubble at the
        // user's drag position; the HUD is a tool, not content.
        panel.sharingType = .none
        if isNewPanel {
            panel.setFrameOrigin(Self.topCenterOrigin(for: size))
        }
        panel.orderFrontRegardless()
        self.panel = panel
    }

    func updateLevel(_ level: Double) {
        state.audioLevel = level
    }

    func hide() {
        panel?.orderOut(nil)
    }

    var isVisible: Bool {
        panel?.isVisible ?? false
    }

    private static func topCenterOrigin(for size: NSSize) -> NSPoint {
        let frame = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        return NSPoint(
            x: frame.midX - size.width / 2,
            y: frame.maxY - size.height - 16
        )
    }
}

@MainActor
private final class VideoRecordingWindowState: ObservableObject {
    @Published var startedAt = Date()
    @Published var audioLevel = 0.0
    var stop: () -> Void = {}
    var discard: () -> Void = {}
}

private struct VideoRecordingPanelView: View {
    @ObservedObject var state: VideoRecordingWindowState
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var hovering = false

    var body: some View {
        HStack(spacing: 12) {
            RecordingDot(reduceMotion: reduceMotion)
            VStack(alignment: .leading, spacing: 1) {
                Text("REC")
                    .font(DSFont.Mono.body())
                    .tracking(1.5)
                    .foregroundStyle(.white.opacity(0.55))
                TimelineView(.periodic(from: state.startedAt, by: 1)) { timeline in
                    Text(elapsedText(now: timeline.date))
                        .font(DSFont.Mono.body())
                        .foregroundStyle(.white)
                }
            }

            VideoLevelBars(level: state.audioLevel)
                .frame(width: 32, height: 24)

            Spacer()

            Image(systemName: "stop.fill")
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(.white)
                .frame(width: 32, height: 32)
                .background(DSColor.State.recording.opacity(0.92), in: Circle())
                .contentShape(Circle())
                .overlay { ActionHitArea(action: state.stop).clipShape(Circle()) }
            .help("Stop and upload recording")

            Image(systemName: "trash")
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(DSColor.State.recording.opacity(0.92))
                .frame(width: 28, height: 28)
                .background(Color.white.opacity(hovering ? 0.16 : 0.10), in: Circle())
                .contentShape(Circle())
                .overlay { ActionHitArea(action: state.discard).clipShape(Circle()) }
            .help("Discard recording")
        }
        .padding(.horizontal, DSSpacing.lg)
        .padding(.vertical, DSSpacing.md)
        .frame(width: 280, height: 56)
        .background(
            RoundedRectangle(cornerRadius: DSRadius.lg)
                .fill(Color(red: 0.10, green: 0.10, blue: 0.11).opacity(0.94))
        )
        .overlay(
            RoundedRectangle(cornerRadius: DSRadius.lg)
                .stroke(Color.white.opacity(0.10), lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.36), radius: 18, x: 0, y: 10)
        .onHover { isHovering in
            withAnimation(.easeOut(duration: 0.12)) {
                hovering = isHovering
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

private struct RecordingDot: View {
    let reduceMotion: Bool

    var body: some View {
        if reduceMotion {
            Circle()
                .fill(DSColor.State.recording)
                .frame(width: 10, height: 10)
        } else {
            TimelineView(.animation(minimumInterval: 0.05)) { timeline in
                let pulse = pulseAlpha(at: timeline.date)
                Circle()
                    .fill(DSColor.State.recording.opacity(pulse))
                    .frame(width: 10, height: 10)
            }
        }
    }

    private func pulseAlpha(at date: Date) -> Double {
        // Smooth ~1Hz pulse between 0.55 and 1.0.
        let t = date.timeIntervalSinceReferenceDate
        let phase = (sin(t * 2 * .pi) + 1) / 2  // 0..1
        return 0.55 + phase * 0.45
    }
}

private struct VideoLevelBars: View {
    let level: Double

    var body: some View {
        TimelineView(.animation(minimumInterval: 0.1)) { timeline in
            HStack(alignment: .center, spacing: 2.5) {
                ForEach(0..<5) { index in
                    Capsule()
                        .fill(DSColor.State.success)
                        .frame(
                            width: 3.5,
                            height: barHeight(index: index, date: timeline.date)
                        )
                }
            }
        }
        .accessibilityLabel("Live audio level")
    }

    private func barHeight(index: Int, date: Date) -> CGFloat {
        let pulse = (sin(date.timeIntervalSinceReferenceDate * 8 + Double(index)) + 1) / 2
        let floor = 4.0
        let scaled = floor + min(1, max(0, level)) * (6 + pulse * 12)
        return CGFloat(scaled)
    }
}
