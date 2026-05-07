import SwiftUI

/// VIDEO-ONLY recording surface in the main window. Routed by
/// `MainRecorderView.contentForCurrentState` only when
/// `viewModel.activeRecordingKind == .video`.
///
/// Audio note recordings DO NOT show this view — they show
/// `NoteWorkspaceView` (the bottom pill is the active control). The
/// router was changed in Stage 8 to send audio recordings to the
/// note workspace; any audio code in this file would be dead.
///
/// If you're adding pause/resume or other recording-control changes,
/// edit BOTH this file (video) AND `NoteWorkspaceView.recordingControlBar`
/// (audio). They are the only two recording-control surfaces.
struct RecordingHomeView: View {
    @ObservedObject var viewModel: RecorderViewModel

    var body: some View {
        VStack(spacing: DSSpacing.xl) {
            Spacer()

            VStack(spacing: DSSpacing.md) {
                pulsingDot
                Text("Recording")
                    .font(DSFont.Display.lg())
                    .foregroundStyle(DSColor.Text.primary)
            }

            timer
                .font(DSFont.Mono.timer())
                .foregroundStyle(DSColor.Text.primary)

            VideoLevelMeter(level: viewModel.audioLevel)
                .frame(width: 160, height: 28)

            actions

            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(DSSpacing.xxxl)
        .background(DSColor.Bg.canvas)
    }

    private var pulsingDot: some View {
        TimelineView(.animation(minimumInterval: 0.05)) { context in
            Circle()
                .fill(DSColor.State.recording.opacity(pulseAlpha(at: context.date)))
                .frame(width: 14, height: 14)
        }
    }

    private func pulseAlpha(at date: Date) -> Double {
        let t = date.timeIntervalSinceReferenceDate
        let phase = (sin(t * 2 * .pi) + 1) / 2
        return 0.55 + phase * 0.45
    }

    // MARK: - Timer
    private var startedAt: Date {
        viewModel.activeVideoRecordingStartedAt ?? Date()
    }

    @ViewBuilder
    private var timer: some View {
        TimelineView(.periodic(from: startedAt, by: 1)) { ctx in
            Text(formatElapsed(seconds: ctx.date.timeIntervalSince(startedAt)))
        }
    }

    private func formatElapsed(seconds: TimeInterval) -> String {
        let total = max(0, Int(seconds))
        let h = total / 3600
        let m = (total % 3600) / 60
        let s = total % 60
        if h > 0 {
            return String(format: "%d:%02d:%02d", h, m, s)
        }
        return String(format: "%02d:%02d", m, s)
    }

    // MARK: - Buttons

    @ViewBuilder
    private var actions: some View {
        // Video-only: pause for screen capture is a separate piece of
        // work (AVAssetWriter pause handling + screen-capture
        // coordination is fussier than the audio buffer-drop trick).
        // For audio recordings, see NoteWorkspaceView.recordingControlBar.
        HStack(spacing: DSSpacing.md) {
            PrimaryButton("Stop & upload", icon: "stop.fill", kind: .destructive) {
                viewModel.stopLocalRecordingAndUpload()
            }
            SecondaryButton("Discard", icon: "trash") {
                viewModel.cancelLocalRecording()
            }
        }
    }
}

private struct VideoLevelMeter: View {
    let level: Double

    var body: some View {
        TimelineView(.animation(minimumInterval: 0.1)) { context in
            HStack(alignment: .center, spacing: 3) {
                ForEach(0..<8, id: \.self) { index in
                    Capsule()
                        .fill(barColor(index: index))
                        .frame(width: 4, height: barHeight(index: index, date: context.date))
                }
            }
        }
        .accessibilityLabel("Live audio level")
    }

    private func barHeight(index: Int, date: Date) -> CGFloat {
        let pulse = (sin(date.timeIntervalSinceReferenceDate * 8 + Double(index)) + 1) / 2
        let floor: CGFloat = 6
        let scaled = floor + min(1, max(0, level)) * (10 + pulse * 12)
        return scaled
    }

    private func barColor(index: Int) -> Color {
        // Soft accent; brighter as level rises.
        DSColor.Accent.primary.opacity(0.55 + min(1, level) * 0.4)
    }
}
