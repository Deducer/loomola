import SwiftUI

/// The big "you came here to do this" surface on the idle home view.
/// Two CTAs (Start recording / Audio note) plus inline mic + camera
/// pickers. When an audio note is being authored, swaps in a title
/// field for the user to name it before starting.
struct HeroCaptureSection: View {
    @ObservedObject var viewModel: RecorderViewModel
    @Binding var captureMode: CaptureMode

    var body: some View {
        VStack(alignment: .leading, spacing: DSSpacing.lg) {
            modeSelector
            actions
            divider
            pickers
        }
    }

    private var modeSelector: some View {
        SegmentedControl(selection: $captureMode) { mode in
            HStack(spacing: 6) {
                Image(systemName: mode.symbol)
                    .font(.system(size: 12, weight: .semibold))
                Text(mode.title)
            }
        }
        .frame(maxWidth: 280)
    }

    @ViewBuilder
    private var actions: some View {
        switch captureMode {
        case .video:
            videoActions
        case .audio:
            audioActions
        }
    }

    @ViewBuilder
    private var videoActions: some View {
        if viewModel.activeRecordingKind == .video {
            HStack(spacing: DSSpacing.md) {
                PrimaryButton(
                    "Stop & upload",
                    icon: "stop.fill",
                    kind: .destructive
                ) { viewModel.stopLocalRecordingAndUpload() }
                SecondaryButton("Discard", icon: "trash") {
                    viewModel.cancelLocalRecording()
                }
            }
        } else {
            HStack(spacing: DSSpacing.md) {
                PrimaryButton(
                    viewModel.isStartingRecording ? "Starting…" : "Start recording",
                    icon: "video.fill",
                    isLoading: viewModel.isStartingRecording
                ) {
                    viewModel.startLocalRecording()
                }
                .disabled(viewModel.state == .signedOut || viewModel.activeRecordingKind != nil || viewModel.isStartingRecording)
            }
        }
    }

    @ViewBuilder
    private var audioActions: some View {
        if viewModel.activeRecordingKind == .audio {
            HStack(spacing: DSSpacing.md) {
                PrimaryButton(
                    "Stop & upload",
                    icon: "stop.fill",
                    kind: .destructive
                ) { viewModel.stopAudioNoteRecordingAndUpload() }
                SecondaryButton("Discard", icon: "trash") {
                    viewModel.cancelAudioNoteRecording()
                }
            }
        } else {
            VStack(alignment: .leading, spacing: DSSpacing.md) {
                Field(placeholder: "Audio note title (optional)", text: $viewModel.audioTitle)
                    .frame(maxWidth: 420)
                HStack(spacing: DSSpacing.md) {
                    PrimaryButton("Start audio note", icon: "waveform.circle.fill") {
                        viewModel.startAudioNoteRecording()
                    }
                    .disabled(audioStartDisabled)
                    Toggle("Mic", isOn: $viewModel.includeMicInAudioNote)
                        .toggleStyle(.checkbox)
                        .font(DSFont.Body.sm())
                    Toggle("System audio", isOn: $viewModel.includeSystemAudioInAudioNote)
                        .toggleStyle(.checkbox)
                        .font(DSFont.Body.sm())
                }
            }
        }
    }

    private var divider: some View {
        Rectangle()
            .fill(DSColor.Border.subtle)
            .frame(height: 1)
    }

    private var pickers: some View {
        HStack(spacing: DSSpacing.lg) {
            FieldPicker(
                label: "Microphone",
                placeholder: "System default",
                icon: "mic",
                options: viewModel.captureSources.microphones.map {
                    .init(id: $0.id, title: $0.name)
                },
                selection: Binding(
                    get: { viewModel.selectedMicDeviceID },
                    set: { viewModel.setSelectedMicDevice(id: $0) }
                )
            )
            .frame(maxWidth: .infinity)

            FieldPicker(
                label: "Camera",
                placeholder: "System default",
                icon: "camera",
                options: viewModel.captureSources.cameras.map {
                    .init(id: $0.id, title: $0.name)
                },
                selection: Binding(
                    get: { viewModel.selectedCameraDeviceID },
                    set: { viewModel.setSelectedCameraDevice(id: $0) }
                )
            )
            .frame(maxWidth: .infinity)
        }
    }

    private var audioStartDisabled: Bool {
        viewModel.state == .signedOut ||
            viewModel.activeRecordingKind != nil ||
            (!viewModel.includeMicInAudioNote && !viewModel.includeSystemAudioInAudioNote)
    }
}

/// Capture mode binding, pulled out so MainRecorderView and
/// HeroCaptureSection can share the type.
enum CaptureMode: String, CaseIterable, Hashable {
    case video
    case audio

    var title: String {
        switch self {
        case .video: return "Video"
        case .audio: return "Audio note"
        }
    }

    var symbol: String {
        switch self {
        case .video: return "video.fill"
        case .audio: return "waveform.circle.fill"
        }
    }

    /// Legacy tint used by the M2-era CaptureModeSegment in
    /// MainRecorderView's signedInBody. Removed in M3 Phase 6 cleanup
    /// when that struct is deleted.
    var tint: Color {
        switch self {
        case .video: return DSColor.Accent.primary
        case .audio: return DSColor.State.success
        }
    }
}
