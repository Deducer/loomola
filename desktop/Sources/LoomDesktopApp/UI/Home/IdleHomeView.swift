import SwiftUI

/// Main "signed-in, not recording" surface. Centered capture card,
/// optional meeting prompt, and a Recent strip.
struct IdleHomeView: View {
    @ObservedObject var viewModel: RecorderViewModel
    @ObservedObject var recentService: RecentRecordingsService
    @Binding var captureMode: CaptureMode
    @Binding var folderFilterId: String?
    let topContentPadding: CGFloat
    let onOpenLiveAudioNote: () -> Void
    let onOpenAudioNote: (RecentRecording) -> Void

    private let homeContentMaxWidth: CGFloat = 1080

    private var activeFolderName: String? {
        guard let folderFilterId else { return nil }
        return recentService.folders.first(where: { $0.id == folderFilterId })?.name
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DSSpacing.xl) {
                if let message = homeStatusMessage {
                    homeStatusBanner(message)
                }

                primarySurface

                RecentStrip(
                    service: recentService,
                    captureMode: captureMode,
                    folderFilterId: folderFilterId,
                    activeFolderName: activeFolderName,
                    onClearFolderFilter: { folderFilterId = nil },
                    onOpenAudioNote: onOpenAudioNote
                )
                .padding(.top, DSSpacing.md)
            }
            .padding(.top, topContentPadding)
            .padding(.horizontal, DSSpacing.xxl)
            .padding(.bottom, DSSpacing.xxl)
            .frame(maxWidth: homeContentMaxWidth, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .center)
        }
    }

    private var homeStatusMessage: String? {
        switch viewModel.state {
        case .failed:
            return viewModel.statusMessage
        default:
            return nil
        }
    }

    private func homeStatusBanner(_ message: String) -> some View {
        HStack(alignment: .top, spacing: DSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(DSColor.State.warning)
                .padding(.top, 2)
            Text(message)
                .font(DSFont.Body.sm())
                .foregroundStyle(DSColor.Text.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: DSSpacing.md)
        }
        .padding(.horizontal, DSSpacing.md)
        .padding(.vertical, DSSpacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(DSColor.Bg.surfaceRaised, in: RoundedRectangle(cornerRadius: DSRadius.md))
        .overlay(
            RoundedRectangle(cornerRadius: DSRadius.md)
                .strokeBorder(DSColor.Border.subtle, lineWidth: 1)
        )
    }

    @ViewBuilder
    private var primarySurface: some View {
        if viewModel.activeRecordingKind == .audio {
            activeAudioRecordingCard
        } else {
            heroCard
        }
    }

    private var heroCard: some View {
        VStack(alignment: .leading) {
            HeroCaptureSection(
                viewModel: viewModel,
                captureMode: $captureMode
            )
        }
        .padding(.horizontal, DSSpacing.xl)
        .padding(.vertical, DSSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(DSColor.Bg.surface, in: RoundedRectangle(cornerRadius: DSRadius.lg))
        .dsShadow(.subtle)
    }

    private var activeAudioRecordingCard: some View {
        HStack(alignment: .center, spacing: DSSpacing.lg) {
            ZStack {
                Circle()
                    .fill(
                        viewModel.isAudioNotePaused
                            ? DSColor.Text.tertiary.opacity(0.16)
                            : DSColor.State.recording.opacity(0.16)
                    )
                Image(systemName: viewModel.isAudioNotePaused ? "pause.fill" : "waveform")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(viewModel.isAudioNotePaused ? DSColor.Text.secondary : DSColor.State.recording)
            }
            .frame(width: 44, height: 44)

            VStack(alignment: .leading, spacing: 4) {
                Text(viewModel.isAudioNotePaused ? "Audio note paused" : "Audio note recording")
                    .font(DSFont.Body.lg())
                    .foregroundStyle(DSColor.Text.primary)
                activeAudioElapsed
            }

            Spacer(minLength: DSSpacing.lg)

            HStack(spacing: DSSpacing.sm) {
                SecondaryButton(
                    viewModel.isAudioNotePaused ? "Resume" : "Pause",
                    icon: viewModel.isAudioNotePaused ? "play.fill" : "pause.fill"
                ) {
                    if viewModel.isAudioNotePaused {
                        viewModel.resumeAudioNoteRecording()
                    } else {
                        viewModel.pauseAudioNoteRecording()
                    }
                }
                SecondaryButton("Open note", icon: "square.and.pencil") {
                    onOpenLiveAudioNote()
                }
                if viewModel.isAudioNotePaused {
                    PrimaryButton(
                        "End & upload",
                        icon: "checkmark",
                        kind: .destructive
                    ) {
                        viewModel.stopAudioNoteRecordingAndUpload()
                    }
                }
            }
        }
        .padding(.horizontal, DSSpacing.xl)
        .padding(.vertical, DSSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(DSColor.Bg.surface, in: RoundedRectangle(cornerRadius: DSRadius.lg))
        .overlay(
            RoundedRectangle(cornerRadius: DSRadius.lg)
                .strokeBorder(DSColor.Border.subtle, lineWidth: 1)
        )
        .dsShadow(.subtle)
    }

    @ViewBuilder
    private var activeAudioElapsed: some View {
        if let startedAt = viewModel.activeAudioRecordingStartedAt {
            if viewModel.isAudioNotePaused, let pausedAt = viewModel.audioNotePausedAt {
                let frozen = pausedAt.timeIntervalSince(startedAt)
                    - viewModel.audioNotePausedAccumulatedSeconds
                Text(elapsedString(seconds: frozen))
                    .font(DSFont.Mono.body())
                    .foregroundStyle(DSColor.Text.tertiary)
                    .monospacedDigit()
            } else {
                TimelineView(.periodic(from: startedAt, by: 1)) { context in
                    let elapsed = context.date.timeIntervalSince(startedAt)
                        - viewModel.audioNotePausedAccumulatedSeconds
                    Text(elapsedString(seconds: elapsed))
                        .font(DSFont.Mono.body())
                        .foregroundStyle(DSColor.Text.secondary)
                        .monospacedDigit()
                }
            }
        } else {
            Text("00:00")
                .font(DSFont.Mono.body())
                .foregroundStyle(DSColor.Text.tertiary)
                .monospacedDigit()
        }
    }

    private func elapsedString(seconds: TimeInterval) -> String {
        let total = max(0, Int(seconds))
        let h = total / 3600
        let m = (total % 3600) / 60
        let s = total % 60
        if h > 0 {
            return String(format: "%d:%02d:%02d", h, m, s)
        }
        return String(format: "%02d:%02d", m, s)
    }
}
