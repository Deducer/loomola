import AppKit
import SwiftUI

/// Floating HUD shown during a composite video recording. Lives top-
/// center of the screen by default; user can drag. Mirrors
/// `RecordingStatusOverlayController`'s pattern but in a horizontal
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
        micStatus: VideoMicStatus,
        stop: @escaping () -> Void,
        discard: @escaping () -> Void,
        togglePause: @escaping () -> Void,
        restart: @escaping () -> Void
    ) {
        state.startedAt = startedAt
        state.audioLevel = audioLevel
        state.micStatus = micStatus
        state.togglePause = togglePause
        state.restart = restart
        state.stop = { [weak self] in
            self?.hide()
            stop()
        }
        state.discard = { [weak self] in
            self?.hide()
            discard()
        }

        let size = NSSize(width: Self.width, height: 56)
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

    func updateMicStatus(_ status: VideoMicStatus) {
        state.micStatus = status
    }

    func updatePause(isPaused: Bool, pausedSince: Date?, pausedAccumulated: TimeInterval) {
        state.isPaused = isPaused
        state.pausedSince = pausedSince
        state.pausedAccumulated = pausedAccumulated
    }

    fileprivate static let width: CGFloat = 420

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
    @Published var micStatus: VideoMicStatus = .starting
    @Published var isPaused = false
    @Published var pausedSince: Date?
    @Published var pausedAccumulated: TimeInterval = 0
    var stop: () -> Void = {}
    var discard: () -> Void = {}
    var togglePause: () -> Void = {}
    var restart: () -> Void = {}
}

private struct VideoRecordingPanelView: View {
    @ObservedObject var state: VideoRecordingWindowState
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var hovering = false
    /// Restart throws the take away, so it needs a second click.
    @State private var confirmingRestart = false
    @State private var restartResetTask: Task<Void, Never>?

    var body: some View {
        HStack(spacing: 12) {
            RecordingDot(reduceMotion: reduceMotion, isPaused: state.isPaused)
            VStack(alignment: .leading, spacing: 1) {
                Text(state.isPaused ? "PAUSED" : "REC")
                    .font(DSFont.Mono.body())
                    .tracking(1.5)
                    .foregroundStyle(.white.opacity(0.55))
                TimelineView(.periodic(from: state.startedAt, by: 1)) { timeline in
                    Text(elapsedText(now: timeline.date))
                        .font(DSFont.Mono.body())
                        .foregroundStyle(.white)
                }
            }

            MicIndicator(
                status: state.isPaused ? .starting : state.micStatus,
                level: state.audioLevel,
                isPaused: state.isPaused
            )

            Spacer()

            hudButton(
                icon: state.isPaused ? "play.fill" : "pause.fill",
                tint: .white,
                help: state.isPaused ? "Resume recording" : "Pause recording",
                action: state.togglePause
            )

            if confirmingRestart {
                Text("Restart?")
                    .font(DSFont.Body.sm().weight(.semibold))
                    .foregroundStyle(DSColor.State.warning)
                    .padding(.horizontal, 10)
                    .frame(height: 28)
                    .background(Color.white.opacity(0.12), in: Capsule())
                    .contentShape(Capsule())
                    .overlay {
                        ActionHitArea {
                            confirmingRestart = false
                            state.restart()
                        }
                        .clipShape(Capsule())
                    }
                    .help("Discard this take and start again")
                    .transition(.opacity)
            } else {
                hudButton(
                    icon: "arrow.counterclockwise",
                    tint: .white,
                    help: "Restart: discard this take and start again",
                    action: askToRestart
                )
            }

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
        .frame(width: VideoRecordingWindowController.width, height: 56)
        .background(
            RoundedRectangle(cornerRadius: DSRadius.lg)
                .fill(Color(red: 0.10, green: 0.10, blue: 0.11).opacity(0.94))
        )
        .overlay(
            RoundedRectangle(cornerRadius: DSRadius.lg)
                .stroke(borderColor, lineWidth: state.micStatus == .noMic && !state.isPaused ? 2 : 1)
        )
        .shadow(color: .black.opacity(0.36), radius: 18, x: 0, y: 10)
        .onHover { isHovering in
            withAnimation(.easeOut(duration: 0.12)) {
                hovering = isHovering
            }
        }
    }

    private func hudButton(
        icon: String,
        tint: Color,
        help: String,
        action: @escaping () -> Void
    ) -> some View {
        Image(systemName: icon)
            .font(.system(size: 12, weight: .bold))
            .foregroundStyle(tint)
            .frame(width: 28, height: 28)
            .background(Color.white.opacity(hovering ? 0.16 : 0.10), in: Circle())
            .contentShape(Circle())
            .overlay { ActionHitArea(action: action).clipShape(Circle()) }
            .help(help)
            .accessibilityLabel(help)
    }

    private func askToRestart() {
        withAnimation(.easeOut(duration: 0.12)) { confirmingRestart = true }
        restartResetTask?.cancel()
        restartResetTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            guard !Task.isCancelled else { return }
            withAnimation(.easeOut(duration: 0.12)) { confirmingRestart = false }
        }
    }

    private var borderColor: Color {
        if state.isPaused { return DSColor.State.warning.opacity(0.7) }
        switch state.micStatus {
        case .noMic: return DSColor.State.recording
        case .quiet: return DSColor.State.warning.opacity(0.7)
        case .starting, .live: return Color.white.opacity(0.10)
        }
    }

    private func elapsedText(now: Date) -> String {
        let paused = state.pausedAccumulated + (state.pausedSince.map { now.timeIntervalSince($0) } ?? 0)
        let elapsed = max(0, Int(now.timeIntervalSince(state.startedAt) - paused))
        let minutes = elapsed / 60
        let seconds = elapsed % 60
        return String(format: "%02d:%02d", minutes, seconds)
    }
}

private struct RecordingDot: View {
    let reduceMotion: Bool
    var isPaused = false

    var body: some View {
        if isPaused {
            Circle()
                .fill(DSColor.State.warning)
                .frame(width: 10, height: 10)
        } else if reduceMotion {
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

/// Mic state in the HUD: green mic + live bars while sound is being
/// recorded, amber "No sound" after a stretch of silence, red "No mic"
/// when no audio is reaching the file at all.
private struct MicIndicator: View {
    let status: VideoMicStatus
    let level: Double
    var isPaused = false

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: iconName)
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(color)
                .frame(width: 14)
            if isPaused {
                label("Paused")
            } else {
                statusContent
            }
        }
        .frame(width: 92, alignment: .leading)
        .help(isPaused ? "Recording is paused" : helpText)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(isPaused ? "Recording is paused" : helpText)
    }

    @ViewBuilder
    private var statusContent: some View {
            switch status {
            case .live:
                VideoLevelBars(level: level)
                    .frame(width: 32, height: 24)
            case .starting:
                label("Mic…")
            case .quiet:
                label("No sound")
            case .noMic:
                label("No mic")
            }
    }

    private func label(_ text: String) -> some View {
        Text(text)
            .font(DSFont.Mono.body())
            .foregroundStyle(color)
            .lineLimit(1)
            .fixedSize()
    }

    private var iconName: String {
        status == .noMic ? "mic.slash.fill" : "mic.fill"
    }

    private var color: Color {
        switch status {
        case .live: return DSColor.State.success
        case .starting: return .white.opacity(0.55)
        case .quiet: return DSColor.State.warning
        case .noMic: return DSColor.State.recording
        }
    }

    private var helpText: String {
        switch status {
        case .live: return "Microphone is recording"
        case .starting: return "Starting microphone"
        case .quiet: return "Microphone is on but hasn't picked up sound for 10 seconds"
        case .noMic: return "No audio is being recorded. Check the microphone in Settings."
        }
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
