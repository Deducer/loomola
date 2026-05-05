import SwiftUI

/// Surface shown in the main window while a composite or audio
/// recording is active. Replaces the idle home; the on-screen HUD
/// (`VideoRecordingWindowController` / `AudioRecordingWindowController`)
/// keeps showing — this is the *main-window* representation if the
/// user happens to bring it to front.
struct RecordingHomeView: View {
    @ObservedObject var viewModel: RecorderViewModel

    var body: some View {
        VStack(spacing: DSSpacing.xl) {
            Spacer()

            VStack(spacing: DSSpacing.md) {
                pulsingDot
                Text(headline)
                    .font(DSFont.Display.lg())
                    .foregroundStyle(DSColor.Text.primary)
                if let subtitle {
                    Text(subtitle)
                        .font(DSFont.Body.md())
                        .foregroundStyle(DSColor.Text.secondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
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
                .fill(viewModel.isAudioNotePaused
                    ? DSColor.State.warning
                    : DSColor.State.recording.opacity(pulseAlpha(at: context.date)))
                .frame(width: 14, height: 14)
        }
    }

    private func pulseAlpha(at date: Date) -> Double {
        let t = date.timeIntervalSinceReferenceDate
        let phase = (sin(t * 2 * .pi) + 1) / 2
        return 0.55 + phase * 0.45
    }

    private var headline: String {
        if viewModel.isAudioNotePaused {
            return "Paused"
        }
        switch viewModel.activeRecordingKind {
        case .video: return "Recording"
        case .audio: return "Recording audio note"
        case nil: return "Recording"
        }
    }

    private var subtitle: String? {
        guard viewModel.activeRecordingKind == .audio else { return nil }
        let trimmed = viewModel.audioTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    private var startedAt: Date {
        if viewModel.activeRecordingKind == .video {
            return viewModel.activeVideoRecordingStartedAt ?? Date()
        }
        return viewModel.activeAudioRecordingStartedAt ?? Date()
    }

    @ViewBuilder
    private var timer: some View {
        if viewModel.isAudioNotePaused {
            // Freeze the displayed elapsed time when paused. The
            // TimelineView keeps ticking but the displayed value
            // stays at whatever it was when pause hit. We track
            // the pause boundary via the view-model's
            // pausedElapsedSeconds (next phase), but for now just
            // show "Paused" instead of a frozen time.
            Text("Paused")
        } else {
            TimelineView(.periodic(from: startedAt, by: 1)) { ctx in
                Text(elapsedString(now: ctx.date, startedAt: startedAt))
            }
        }
    }

    private func elapsedString(now: Date, startedAt: Date) -> String {
        let total = max(0, Int(now.timeIntervalSince(startedAt)))
        let h = total / 3600
        let m = (total % 3600) / 60
        let s = total % 60
        if h > 0 {
            return String(format: "%d:%02d:%02d", h, m, s)
        }
        return String(format: "%02d:%02d", m, s)
    }

    @ViewBuilder
    private var actions: some View {
        HStack(spacing: DSSpacing.md) {
            switch viewModel.activeRecordingKind {
            case .video:
                PrimaryButton("Stop & upload", icon: "stop.fill", kind: .destructive) {
                    viewModel.stopLocalRecordingAndUpload()
                }
                SecondaryButton("Discard", icon: "trash") {
                    viewModel.cancelLocalRecording()
                }
            case .audio:
                PrimaryButton("Stop & upload", icon: "stop.fill", kind: .destructive) {
                    viewModel.stopAudioNoteRecordingAndUpload()
                }
                if viewModel.isAudioNotePaused {
                    SecondaryButton("Resume", icon: "play.fill") {
                        viewModel.resumeAudioNoteRecording()
                    }
                } else {
                    SecondaryButton("Pause", icon: "pause.fill") {
                        viewModel.pauseAudioNoteRecording()
                    }
                }
                SecondaryButton("Open note", icon: "doc.text") {
                    viewModel.openActiveAudioNote()
                }
                Menu {
                    Button("Discard recording", role: .destructive) {
                        viewModel.cancelAudioNoteRecording()
                    }
                } label: {
                    Image(systemName: "ellipsis")
                        .font(.system(size: 16, weight: .semibold))
                        .frame(width: 32, height: 32)
                        .foregroundStyle(DSColor.Text.secondary)
                }
                .menuStyle(.borderlessButton)
                .menuIndicator(.hidden)
            case nil:
                EmptyView()
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
