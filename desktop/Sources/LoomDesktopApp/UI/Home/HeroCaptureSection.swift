import AppKit
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
                .disabled(
                    viewModel.state == .signedOut ||
                        viewModel.activeRecordingKind != nil ||
                        viewModel.isStartingRecording ||
                        !viewModel.recorderReadiness.canStart
                )
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
                readinessStatus
                microphonePicker
                cameraPicker
            }
        case .audio:
            HStack(spacing: DSSpacing.lg) {
                readinessStatus
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
            !viewModel.recorderReadiness.canStart ||
            (!viewModel.includeMicInAudioNote && !viewModel.includeSystemAudioInAudioNote) ||
            viewModel.needsSystemAudioDeviceSelection
    }

    private var readinessStatus: some View {
        RecorderReadinessInlineStatus(
            viewModel: viewModel,
            snapshot: viewModel.recorderReadiness
        )
        .frame(width: 148, alignment: .leading)
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

    var readinessMode: RecorderReadinessMode {
        switch self {
        case .video: return .video
        case .audio: return .audio
        }
    }
}

private struct RecorderReadinessInlineStatus: View {
    @ObservedObject var viewModel: RecorderViewModel
    let snapshot: RecorderReadinessSnapshot

    @ObservedObject private var orphanStore = OrphanedRecordingStore.shared
    @State private var hovering = false
    @State private var showDetails = false

    var body: some View {
        HStack(alignment: .center, spacing: DSSpacing.sm) {
            statusGlyph
                .frame(width: 16, height: 16)

            Text(compactTitle)
                .font(DSFont.Body.md())
                .foregroundStyle(DSColor.Text.primary)
                .lineLimit(1)

            if hasDetails {
                Image(systemName: "chevron.down")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(DSColor.Text.tertiary)
                    .rotationEffect(.degrees(showDetails ? 180 : 0))
            }
        }
        .padding(.horizontal, DSSpacing.md)
        .padding(.vertical, DSSpacing.sm)
        .background(
            Capsule(style: .continuous)
                .fill(hovering || showDetails ? DSColor.Bg.surfaceRaised : DSColor.Bg.subtle)
        )
        .overlay(
            Capsule(style: .continuous)
                .strokeBorder(statusColor.opacity(borderOpacity), lineWidth: 1)
        )
        .contentShape(Capsule(style: .continuous))
        .overlay {
            ActionHitArea(isEnabled: hasDetails) {
                showDetails.toggle()
            }
            .clipShape(Capsule(style: .continuous))
        }
        .popover(isPresented: $showDetails, arrowEdge: .bottom) {
            RecorderReadinessPopover(
                viewModel: viewModel,
                snapshot: snapshot,
                orphanStore: orphanStore
            )
        }
        .onHover { hovering = $0 }
        .animation(LoomolaMotion.quick, value: hovering)
        .animation(LoomolaMotion.quick, value: showDetails)
    }

    @ViewBuilder
    private var statusGlyph: some View {
        switch snapshot.state {
        case .checking:
            ProgressView()
                .controlSize(.small)
                .tint(DSColor.Accent.primary)
        case .ready, .degraded:
            Image(systemName: "checkmark")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(DSColor.State.success)
        case .blocked:
            Image(systemName: "xmark")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(DSColor.State.recording)
        }
    }

    private var compactTitle: String {
        switch snapshot.state {
        case .checking: return "Checking"
        case .ready, .degraded: return "Ready"
        case .blocked: return "Check setup"
        }
    }

    private var statusColor: Color {
        switch snapshot.state {
        case .checking: return DSColor.Accent.primary
        case .ready: return DSColor.State.success
        case .degraded: return DSColor.State.warning
        case .blocked: return DSColor.State.recording
        }
    }

    private var borderOpacity: Double {
        hovering || showDetails || snapshot.state != .ready ? 0.42 : 0.14
    }

    private var hasDetails: Bool {
        snapshot.state != .checking && !snapshot.issues.isEmpty
    }
}

private struct RecorderReadinessPopover: View {
    @ObservedObject var viewModel: RecorderViewModel
    let snapshot: RecorderReadinessSnapshot
    @ObservedObject var orphanStore: OrphanedRecordingStore

    var body: some View {
        VStack(alignment: .leading, spacing: DSSpacing.md) {
            if let orphan = firstUnrescuedOrphan {
                recoveryCard(orphan)
            }

            ForEach(otherIssues, id: \.id) { issue in
                issueRow(issue)
            }
        }
        .padding(DSSpacing.lg)
        .frame(width: 360, alignment: .leading)
        .background(DSColor.Bg.surface)
    }

    private func recoveryCard(_ orphan: OrphanedRecording) -> some View {
        VStack(alignment: .leading, spacing: DSSpacing.md) {
            HStack(alignment: .firstTextBaseline, spacing: DSSpacing.sm) {
                Text("Recovery")
                    .font(DSFont.Body.lg())
                    .foregroundStyle(DSColor.Text.primary)
                Spacer()
                if viewModel.orphanRetryInProgress == orphan.id {
                    ProgressView()
                        .controlSize(.small)
                        .tint(DSColor.Accent.primary)
                }
            }

            VStack(alignment: .leading, spacing: 3) {
                Text(orphan.title?.isEmpty == false ? orphan.title! : "Unsaved audio recording")
                    .font(DSFont.Body.md())
                    .foregroundStyle(DSColor.Text.primary)
                    .lineLimit(1)
                Text(orphanSubtitle(orphan))
                    .font(DSFont.Body.sm())
                    .foregroundStyle(DSColor.Text.secondary)
                    .lineLimit(1)
            }

            if let lastError = orphan.lastError, !lastError.isEmpty {
                Text(lastError)
                    .font(DSFont.Body.sm())
                    .foregroundStyle(DSColor.Text.tertiary)
                    .lineLimit(2)
            }

            HStack(spacing: DSSpacing.sm) {
                popoverIconButton(
                    icon: "arrow.up.circle.fill",
                    tint: DSColor.Accent.primary,
                    disabled: viewModel.orphanRetryInProgress != nil
                ) {
                    viewModel.retryOrphan(orphan)
                }
                popoverIconButton(icon: "folder") {
                    NSWorkspace.shared.activateFileViewerSelecting([orphan.storageDirectory])
                }
                popoverIconButton(
                    icon: "trash",
                    tint: DSColor.State.recording,
                    disabled: viewModel.orphanRetryInProgress == orphan.id
                ) {
                    viewModel.discardOrphan(orphan)
                }
            }
        }
        .padding(DSSpacing.md)
        .background(DSColor.Bg.surfaceRaised, in: RoundedRectangle(cornerRadius: DSRadius.md))
        .overlay(
            RoundedRectangle(cornerRadius: DSRadius.md)
                .strokeBorder(DSColor.Border.subtle, lineWidth: 1)
        )
    }

    private func issueRow(_ issue: RecorderReadinessIssue) -> some View {
        HStack(alignment: .top, spacing: DSSpacing.sm) {
            Image(systemName: issue.severity == .blocker ? "xmark" : "circle.fill")
                .font(.system(size: issue.severity == .blocker ? 11 : 6, weight: .semibold))
                .foregroundStyle(issue.severity == .blocker ? DSColor.State.recording : DSColor.State.warning)
                .frame(width: 14, height: 18)

            VStack(alignment: .leading, spacing: 2) {
                Text(issue.title)
                    .font(DSFont.Body.md())
                    .foregroundStyle(DSColor.Text.primary)
                Text(issue.message)
                    .font(DSFont.Body.sm())
                    .foregroundStyle(DSColor.Text.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func popoverIconButton(
        icon: String,
        tint: Color = DSColor.Text.secondary,
        disabled: Bool = false,
        action: @escaping () -> Void
    ) -> some View {
        Image(systemName: icon)
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(disabled ? DSColor.Text.tertiary : tint)
            .frame(width: 30, height: 30)
            .background(Circle().fill(DSColor.Bg.subtle))
            .contentShape(Circle())
            .overlay {
                ActionHitArea(isEnabled: !disabled, action: action)
                    .clipShape(Circle())
            }
    }

    private var firstUnrescuedOrphan: OrphanedRecording? {
        orphanStore.orphans.first { $0.rescuedSlug == nil }
    }

    private var otherIssues: [RecorderReadinessIssue] {
        snapshot.issues.filter {
            firstUnrescuedOrphan == nil || $0.id != "orphaned-recording"
        }
    }

    private func orphanSubtitle(_ orphan: OrphanedRecording) -> String {
        let mins = Int(orphan.durationSeconds / 60)
        let secs = Int(orphan.durationSeconds.truncatingRemainder(dividingBy: 60))
        let mb = Double(orphan.totalBytes()) / 1024 / 1024
        return String(format: "%d:%02d · %.1f MB", mins, secs, mb)
    }
}
