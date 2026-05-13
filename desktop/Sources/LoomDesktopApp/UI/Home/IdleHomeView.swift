import SwiftUI

/// Main "signed-in, not recording" surface. Big "Capture" headline,
/// hero CTA card, optional meeting prompt, and a Recent strip.
struct IdleHomeView: View {
    @ObservedObject var viewModel: RecorderViewModel
    @ObservedObject var recentService: RecentRecordingsService
    @Binding var captureMode: CaptureMode
    @Binding var folderFilterId: String?
    let topContentPadding: CGFloat
    let onOpenLiveAudioNote: () -> Void
    let onOpenAudioNote: (RecentRecording) -> Void

    private var activeFolderName: String? {
        guard let folderFilterId else { return nil }
        return recentService.folders.first(where: { $0.id == folderFilterId })?.name
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DSSpacing.xl) {
                Text("Capture")
                    .font(DSFont.Display.xl())
                    .foregroundStyle(DSColor.Text.primary)
                    .padding(.top, topContentPadding)

                if let message = homeStatusMessage {
                    homeStatusBanner(message)
                }

                if viewModel.activeRecordingKind == .audio {
                    activeAudioRecordingCard
                } else {
                    heroCard
                }

                if let context = viewModel.meetingPromptContext {
                    meetingPromptCard(context: context)
                }

                RecentStrip(
                    service: recentService,
                    captureMode: captureMode,
                    folderFilterId: folderFilterId,
                    activeFolderName: activeFolderName,
                    onClearFolderFilter: { folderFilterId = nil },
                    onOpenAudioNote: onOpenAudioNote
                )
                .padding(.top, DSSpacing.lg)
            }
            .padding(.horizontal, DSSpacing.xxl)
            .padding(.bottom, DSSpacing.xxl)
            .frame(maxWidth: .infinity, alignment: .leading)
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

    private var heroCard: some View {
        VStack(alignment: .leading) {
            HeroCaptureSection(viewModel: viewModel, captureMode: $captureMode)
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

    private func meetingPromptCard(context: MeetingContext) -> some View {
        HStack(alignment: .center, spacing: DSSpacing.lg) {
            Image(systemName: "waveform.circle.fill")
                .font(.system(size: 28, weight: .semibold))
                .foregroundStyle(DSColor.State.success)
            VStack(alignment: .leading, spacing: 2) {
                Text("Meeting ready")
                    .font(DSFont.Body.lg())
                    .foregroundStyle(DSColor.Text.primary)
                Text(context.suggestedTitle)
                    .font(DSFont.Body.md())
                    .foregroundStyle(DSColor.Text.secondary)
                    .lineLimit(1)
                Text(context.sourceContextHint)
                    .font(DSFont.Body.sm())
                    .foregroundStyle(DSColor.Text.tertiary)
                    .lineLimit(1)
            }
            Spacer()
            HStack(spacing: DSSpacing.sm) {
                PrimaryButton("Start audio") {
                    viewModel.startDetectedMeetingAudioNote()
                }
                if context.joinURL != nil || context.bundleIdentifier != nil {
                    SecondaryButton(joinLabel(for: context)) {
                        viewModel.joinDetectedMeeting()
                    }
                }
                SecondaryButton("Dismiss") {
                    viewModel.dismissMeetingPrompt()
                }
            }
        }
        .padding(.horizontal, DSSpacing.xl)
        .padding(.vertical, DSSpacing.lg)
        .background(DSColor.Bg.surface, in: RoundedRectangle(cornerRadius: DSRadius.lg))
        .dsShadow(.subtle)
    }

    private func joinLabel(for context: MeetingContext) -> String {
        switch context.detectedApp {
        case "google-meet", "meet": return "Open Meet"
        case "zoom": return "Open Zoom"
        case "teams": return "Open Teams"
        case "webex": return "Open Webex"
        default: return "Open meeting"
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
