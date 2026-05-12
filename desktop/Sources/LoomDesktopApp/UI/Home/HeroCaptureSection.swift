import SwiftUI

/// The big "you came here to do this" surface on the idle home view.
/// Two CTAs (Start recording / Audio note) plus inline mic + camera
/// pickers. When an audio note is being authored, swaps in a title
/// field for the user to name it before starting.
struct HeroCaptureSection: View {
    @ObservedObject var viewModel: RecorderViewModel
    @Binding var captureMode: CaptureMode

    var body: some View {
        VStack(alignment: .leading, spacing: DSSpacing.md) {
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
            // While an audio note is recording the workspace panel
            // owns the recording UI — the main window stays on the
            // home view. Show nothing here so we don't duplicate
            // Stop/Discard.
            EmptyView()
        } else {
            // Title input was removed in 1f98c3e — the workspace's
            // title editor is the single source of truth. Cleaner;
            // matches Granola.
            HStack(spacing: DSSpacing.md) {
                PrimaryButton(
                    viewModel.isStartingRecording ? "Starting…" : "Start audio note",
                    icon: "waveform.circle.fill",
                    isLoading: viewModel.isStartingRecording
                ) {
                    viewModel.startAudioNoteRecording()
                }
                .disabled(audioStartDisabled)
                Toggle("Mic", isOn: $viewModel.includeMicInAudioNote)
                    .toggleStyle(.checkbox)
                    .font(DSFont.Body.sm())
                Toggle("System audio", isOn: $viewModel.includeSystemAudioInAudioNote)
                    .toggleStyle(.checkbox)
                    .font(DSFont.Body.sm())
                    .disabled(viewModel.systemAudioCaptureMode == .audioDevice && viewModel.selectedSystemAudioDeviceID == nil)
            }
            if viewModel.needsSystemAudioDeviceSelection {
                Text("Choose a virtual system audio device in Settings before enabling system audio.")
                    .font(DSFont.Body.sm())
                    .foregroundStyle(DSColor.State.warning)
                    .fixedSize(horizontal: false, vertical: true)
            } else if viewModel.systemAudioCaptureMode == .audioDevice &&
                        viewModel.selectedSystemAudioDeviceID == nil
            {
                Text("Mic-only is safest for calls. Add a virtual audio device later for system audio.")
                    .font(DSFont.Body.sm())
                    .foregroundStyle(DSColor.Text.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var divider: some View {
        Rectangle()
            .fill(DSColor.Border.subtle)
            .frame(height: 1)
    }

    @ViewBuilder
    private var pickers: some View {
        switch captureMode {
        case .video:
            HStack(spacing: DSSpacing.lg) {
                microphonePicker
                cameraPicker
            }
        case .audio:
            HStack(spacing: DSSpacing.lg) {
                microphonePicker
                if viewModel.includeSystemAudioInAudioNote &&
                    viewModel.systemAudioCaptureMode == .audioDevice
                {
                    systemAudioDevicePicker
                }
            }
        }
    }

    private var microphonePicker: some View {
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
    }

    private var cameraPicker: some View {
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

    private var systemAudioDevicePicker: some View {
        FieldPicker(
            label: "System audio device",
            placeholder: "Choose virtual audio device",
            icon: "slider.horizontal.3",
            options: viewModel.captureSources.microphones.map {
                .init(id: $0.id, title: $0.name)
            },
            selection: Binding(
                get: { viewModel.selectedSystemAudioDeviceID },
                set: { viewModel.setSelectedSystemAudioDevice(id: $0) }
            )
        )
        .frame(maxWidth: .infinity)
    }

    private var audioStartDisabled: Bool {
        viewModel.state == .signedOut ||
            viewModel.activeRecordingKind != nil ||
            viewModel.isStartingRecording ||
            (!viewModel.includeMicInAudioNote && !viewModel.includeSystemAudioInAudioNote) ||
            viewModel.needsSystemAudioDeviceSelection
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
