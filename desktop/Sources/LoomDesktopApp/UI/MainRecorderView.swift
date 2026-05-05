import AppKit
import SwiftUI

struct MainRecorderView: View {
    @StateObject private var viewModel = RecorderViewModel()
    @State private var meetingPromptWindow = MeetingPromptWindowController()
    @State private var audioRecordingWindow = AudioRecordingWindowController()
    @State private var videoRecordingWindow = VideoRecordingWindowController()
    @State private var permissionStatus: PermissionStatus = PermissionChecker.currentStatus()
    @State private var dismissedPreflight = false
    @State private var captureMode: CaptureMode = .audio
    @FocusState private var focusedField: FocusedField?

    var body: some View {
        VStack(spacing: 0) {
            AppHeader(state: viewModel.state)

            Divider()

            if viewModel.state == .signedOut {
                SignedOutView(
                    email: $viewModel.email,
                    password: $viewModel.password,
                    signIn: { viewModel.signIn() },
                    focusedField: $focusedField
                )
            } else {
                signedInBody
            }
        }
        .background(Color(nsColor: .windowBackgroundColor))
        .onAppear {
            AppActivation.bringRecorderToFront()
            focusDefaultField()
        }
        .task {
            await viewModel.restoreSession()
        }
        .onChange(of: viewModel.state) { _, _ in
            focusDefaultField()
        }
        .onChange(of: viewModel.meetingPromptContext) { _, _ in
            updateMeetingPromptWindow()
        }
        .onChange(of: viewModel.meetingContext) { _, context in
            if context != nil && viewModel.activeRecordingKind == nil {
                captureMode = .audio
            }
        }
        .onChange(of: viewModel.activeRecordingKind) { _, kind in
            updateMeetingPromptWindow()
            updateAudioRecordingWindow()
            updateVideoRecordingWindow()
            RecorderCommands.isVideoRecording = (kind == .video)
        }
        .onChange(of: viewModel.activeAudioRecordingStartedAt) { _, _ in
            updateAudioRecordingWindow()
        }
        .onChange(of: viewModel.audioTitle) { _, _ in
            updateAudioRecordingWindow()
        }
        .onChange(of: viewModel.audioLevel) { _, level in
            handleAudioLevelChange(level: level)
        }
        .onChange(of: viewModel.includeMicInAudioNote) { _, _ in
            updateMeetingPromptWindow()
        }
        .onChange(of: viewModel.includeSystemAudioInAudioNote) { _, _ in
            updateMeetingPromptWindow()
        }
        .onDisappear {
            meetingPromptWindow.hide()
            audioRecordingWindow.hide()
            videoRecordingWindow.hide()
        }
        .onReceive(NotificationCenter.default.publisher(for: RecorderCommands.toggleRecording)) { _ in
            handleToggleRecording()
        }
    }

    /// Bridges menubar / global-hotkey toggle requests to the view
    /// model. Decides start vs stop based on activeRecordingKind:
    ///   - nil → startLocalRecording (composite video)
    ///   - .video → stopLocalRecordingAndUpload
    ///   - .audio → no-op (audio note has its own start/stop UX)
    private func handleToggleRecording() {
        switch viewModel.activeRecordingKind {
        case nil:
            viewModel.startLocalRecording()
        case .some(.video):
            viewModel.stopLocalRecordingAndUpload()
        case .some(.audio):
            // Audio note flow has its own controls; ignore global
            // toggle while an audio note is recording.
            break
        }
    }

    private var signedInBody: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if !dismissedPreflight && permissionStatus.requiredMissing {
                        PermissionsView(
                            onComplete: {
                                permissionStatus = PermissionChecker.currentStatus()
                                dismissedPreflight = !permissionStatus.requiredMissing
                            }
                        )
                        .onReceive(NotificationCenter.default.publisher(for: NSWindow.didBecomeKeyNotification)) { _ in
                            permissionStatus = PermissionChecker.currentStatus()
                        }
                    }

                    if let context = viewModel.meetingPromptContext {
                        MeetingPromptView(
                            context: context,
                            start: { viewModel.startDetectedMeetingAudioNote() },
                            dismiss: { viewModel.dismissMeetingPrompt() },
                            startDisabled: audioStartDisabled
                        )
                    }

                    CaptureCard(
                        mode: $captureMode,
                        title: $viewModel.audioTitle,
                        includeMic: $viewModel.includeMicInAudioNote,
                        includeSystemAudio: $viewModel.includeSystemAudioInAudioNote,
                        state: viewModel.state,
                        activeRecordingKind: viewModel.activeRecordingKind,
                        meetingContext: viewModel.meetingContext,
                        audioStartDisabled: audioStartDisabled,
                        startVideo: { viewModel.startLocalRecording() },
                        stopVideo: { viewModel.stopLocalRecordingAndUpload() },
                        startAudio: { viewModel.startAudioNoteRecording() },
                        stopAudio: { viewModel.stopAudioNoteRecordingAndUpload() },
                        discardAudio: { viewModel.cancelAudioNoteRecording() },
                        checkMeeting: { viewModel.checkMeetingContext() }
                    )

                    SourcePickerCard(
                        cameras: viewModel.captureSources.cameras,
                        microphones: viewModel.captureSources.microphones,
                        selectedCameraID: viewModel.selectedCameraDeviceID,
                        selectedMicID: viewModel.selectedMicDeviceID,
                        onSelectCamera: { id in viewModel.setSelectedCameraDevice(id: id) },
                        onSelectMic: { id in viewModel.setSelectedMicDevice(id: id) },
                        onRefresh: { viewModel.refreshCaptureSources() }
                    )

                    IntegrationsCard(
                        nativeMessagingStatus: viewModel.nativeMessagingStatus,
                        isInstallingNativeMessagingHost: viewModel.isInstallingNativeMessagingHost,
                        installChromeBridge: { viewModel.installNativeMessagingHost() },
                        showExtensionFolder: { viewModel.openExtensionFolder() },
                        syncObsidian: { viewModel.syncPendingObsidianNotes() }
                    )

                    CaptureSourcesView(snapshot: viewModel.captureSources)

                    StatusCard(message: viewModel.statusMessage)

                    DeveloperToolsDisclosure {
                        DiagnosticsCard(
                            state: viewModel.state,
                            activeRecordingKind: viewModel.activeRecordingKind,
                            testVideoBackend: { viewModel.startAndAbortBackendHandshake() },
                            testAudioBackend: { viewModel.startAndAbortAudioBackendHandshake() }
                        )
                    }
                }
                .padding(24)
            }

            FooterBar(
                refreshSources: { viewModel.refreshCaptureSources() },
                openLibrary: { NSWorkspace.shared.open(URL(string: "https://loom.dissonance.cloud")!) },
                signOut: { viewModel.signOut() }
            )
        }
    }

    private var audioStartDisabled: Bool {
        viewModel.state == .signedOut ||
            viewModel.activeRecordingKind != nil ||
            (!viewModel.includeMicInAudioNote && !viewModel.includeSystemAudioInAudioNote)
    }

    private func focusDefaultField() {
        if viewModel.state == .signedOut {
            focusedField = .email
        }
    }

    private func updateMeetingPromptWindow() {
        guard let context = viewModel.meetingPromptContext else {
            meetingPromptWindow.hide()
            return
        }
        meetingPromptWindow.show(
            context: context,
            startDisabled: audioStartDisabled,
            start: { viewModel.startDetectedMeetingAudioNote() },
            dismiss: { viewModel.dismissMeetingPrompt() }
        )
    }

    private func handleAudioLevelChange(level: Double) {
        updateAudioRecordingWindow()
        videoRecordingWindow.updateLevel(level)
    }

    private func updateVideoRecordingWindow() {
        guard
            viewModel.activeRecordingKind == .video,
            let startedAt = viewModel.activeVideoRecordingStartedAt
        else {
            videoRecordingWindow.hide()
            return
        }
        videoRecordingWindow.show(
            startedAt: startedAt,
            audioLevel: viewModel.audioLevel,
            stop: { viewModel.stopLocalRecordingAndUpload() },
            discard: { viewModel.cancelLocalRecording() }
        )
    }

    private func updateAudioRecordingWindow() {
        guard
            viewModel.activeRecordingKind == .audio,
            let startedAt = viewModel.activeAudioRecordingStartedAt
        else {
            audioRecordingWindow.hide()
            return
        }
        audioRecordingWindow.show(
            title: viewModel.audioTitle,
            startedAt: startedAt,
            audioLevel: viewModel.audioLevel,
            openNote: { viewModel.openActiveAudioNote() },
            stop: { viewModel.stopAudioNoteRecordingAndUpload() },
            discard: { viewModel.cancelAudioNoteRecording() }
        )
    }
}

private enum FocusedField: Hashable {
    case email
    case password
}

private extension DesktopRecordingKind {
    var label: String {
        switch self {
        case .video: return "Video recording"
        case .audio: return "Audio recording"
        }
    }
}

private enum CaptureMode: String, CaseIterable, Hashable {
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

    var tint: Color {
        switch self {
        case .video: return .blue
        case .audio: return .green
        }
    }
}

private struct AppHeader: View {
    let state: RecorderState

    var body: some View {
        HStack(spacing: 14) {
            BrandLogoMark(size: 42)

            VStack(alignment: .leading, spacing: 2) {
                Text("Loomola Desktop")
                    .font(.title2.weight(.semibold))
                Text("Capture")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.secondary)
            }

            Spacer()

            StatusPill(state: state)
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 18)
    }
}

private struct SignedOutView: View {
    @Binding var email: String
    @Binding var password: String
    let signIn: () -> Void
    var focusedField: FocusState<FocusedField?>.Binding

    var body: some View {
        VStack {
            Spacer()

            Card {
                VStack(alignment: .leading, spacing: 14) {
                    Label("Sign in", systemImage: "person.crop.circle")
                        .font(.headline)
                    TextField("Email", text: $email)
                        .textFieldStyle(.roundedBorder)
                        .focused(focusedField, equals: .email)
                    SecureField("Password", text: $password)
                        .textFieldStyle(.roundedBorder)
                        .focused(focusedField, equals: .password)
                    Button {
                        signIn()
                    } label: {
                        Label("Sign in", systemImage: "arrow.right")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .keyboardShortcut(.return, modifiers: [.command])
                }
            }
            .frame(maxWidth: 420)

            Spacer()
        }
        .padding(24)
    }
}

private struct CaptureCard: View {
    @Binding var mode: CaptureMode
    @Binding var title: String
    @Binding var includeMic: Bool
    @Binding var includeSystemAudio: Bool
    let state: RecorderState
    let activeRecordingKind: DesktopRecordingKind?
    let meetingContext: MeetingContext?
    let audioStartDisabled: Bool
    let startVideo: () -> Void
    let stopVideo: () -> Void
    let startAudio: () -> Void
    let stopAudio: () -> Void
    let discardAudio: () -> Void
    let checkMeeting: () -> Void

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 12) {
                    Label("Capture", systemImage: "record.circle")
                        .font(.headline)
                    Spacer()
                    if let activeRecordingKind {
                        Label(activeRecordingKind.label, systemImage: "dot.radiowaves.left.and.right")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                    }
                }

                CaptureModeSelector(mode: $mode, disabled: activeRecordingKind != nil)

                if mode == .video {
                    videoControls
                } else {
                    audioControls
                }
            }
        }
    }

    private var videoControls: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                if activeRecordingKind == .video {
                    Button {
                        stopVideo()
                    } label: {
                        Label("Stop Video", systemImage: "stop.fill")
                    }
                    .buttonStyle(.borderedProminent)
                } else {
                    Button {
                        startVideo()
                    } label: {
                        Label("Start Video Recording", systemImage: "video.fill")
                    }
                    .buttonStyle(.borderedProminent)
                    .keyboardShortcut("r", modifiers: [.command])
                    .disabled(state == .signedOut || activeRecordingKind != nil)
                }
            }
        }
    }

    private var audioControls: some View {
        VStack(alignment: .leading, spacing: 12) {
            TextField(meetingContext?.suggestedTitle ?? "Auto-title after processing", text: $title)
                .textFieldStyle(.roundedBorder)

            HStack(spacing: 14) {
                Toggle("Mic", isOn: $includeMic)
                Toggle("System audio", isOn: $includeSystemAudio)
            }

            if let meetingContext {
                Label(meetingContext.sourceContextHint, systemImage: "person.2.wave.2")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            HStack(spacing: 10) {
                if activeRecordingKind == .audio {
                    Button {
                        stopAudio()
                    } label: {
                        Label("Stop Audio", systemImage: "stop.fill")
                    }
                    .buttonStyle(.borderedProminent)

                    Button {
                        discardAudio()
                    } label: {
                        Label("Discard", systemImage: "trash")
                    }
                } else {
                    Button {
                        startAudio()
                    } label: {
                        Label("Start Audio Note", systemImage: "waveform")
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.green)
                    .keyboardShortcut("r", modifiers: [.command])
                    .disabled(audioStartDisabled)
                }

                Button {
                    checkMeeting()
                } label: {
                    Label("Check Meeting", systemImage: "sparkle.magnifyingglass")
                }
                .disabled(state == .signedOut || activeRecordingKind != nil)
            }
        }
    }
}

private struct CaptureModeSelector: View {
    @Binding var mode: CaptureMode
    let disabled: Bool

    var body: some View {
        HStack(spacing: 4) {
            ForEach(CaptureMode.allCases, id: \.self) { option in
                CaptureModeSegment(
                    option: option,
                    isSelected: mode == option,
                    onSelect: { mode = option }
                )
            }
        }
        .padding(4)
        .background(
            RoundedRectangle(cornerRadius: 10)
                .fill(Color.primary.opacity(0.06))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .stroke(Color.primary.opacity(0.10), lineWidth: 1)
        )
        .disabled(disabled)
    }
}

private struct CaptureModeSegment: View {
    let option: CaptureMode
    let isSelected: Bool
    let onSelect: () -> Void

    @State private var hovering = false

    var body: some View {
        Button(action: onSelect) {
            HStack(spacing: 6) {
                Image(systemName: option.symbol)
                    .font(.system(size: 13, weight: .semibold))
                Text(option.title)
                    .font(.subheadline.weight(.semibold))
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
            .foregroundStyle(isSelected ? Color.white : Color.primary.opacity(hovering ? 0.92 : 0.7))
            .background(
                ZStack {
                    if isSelected {
                        RoundedRectangle(cornerRadius: 7)
                            .fill(option.tint)
                            .shadow(color: option.tint.opacity(0.35), radius: 4, x: 0, y: 1)
                    } else if hovering {
                        RoundedRectangle(cornerRadius: 7)
                            .fill(Color.primary.opacity(0.06))
                    }
                }
            )
            .contentShape(RoundedRectangle(cornerRadius: 7))
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .animation(.easeOut(duration: 0.12), value: isSelected)
        .animation(.easeOut(duration: 0.12), value: hovering)
    }
}

private struct IntegrationsCard: View {
    let nativeMessagingStatus: String
    let isInstallingNativeMessagingHost: Bool
    let installChromeBridge: () -> Void
    let showExtensionFolder: () -> Void
    let syncObsidian: () -> Void

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: 14) {
                Label("Integrations", systemImage: "puzzlepiece.extension")
                    .font(.headline)

                HStack(alignment: .top, spacing: 16) {
                    IntegrationBlock(
                        title: "Chrome bridge",
                        status: nativeMessagingStatus,
                        symbol: "globe",
                        primaryTitle: isInstallingNativeMessagingHost ? "Installing..." : "Install",
                        primarySymbol: "bolt.horizontal",
                        primaryAction: installChromeBridge,
                        secondaryTitle: "Extension Folder",
                        secondarySymbol: "folder",
                        secondaryAction: showExtensionFolder,
                        primaryDisabled: isInstallingNativeMessagingHost
                    )

                    Divider()

                    IntegrationBlock(
                        title: "Obsidian",
                        status: "Realtime sync with polling backup",
                        symbol: "square.and.arrow.down",
                        primaryTitle: "Sync Now",
                        primarySymbol: "arrow.triangle.2.circlepath",
                        primaryAction: syncObsidian,
                        secondaryTitle: nil,
                        secondarySymbol: nil,
                        secondaryAction: nil,
                        primaryDisabled: false
                    )
                }
            }
        }
    }
}

private struct IntegrationBlock: View {
    let title: String
    let status: String
    let symbol: String
    let primaryTitle: String
    let primarySymbol: String
    let primaryAction: () -> Void
    let secondaryTitle: String?
    let secondarySymbol: String?
    let secondaryAction: (() -> Void)?
    let primaryDisabled: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(title, systemImage: symbol)
                .font(.subheadline.weight(.semibold))
            Text(status)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(2)

            HStack(spacing: 8) {
                Button {
                    primaryAction()
                } label: {
                    Label(primaryTitle, systemImage: primarySymbol)
                }
                .disabled(primaryDisabled)

                if let secondaryTitle, let secondarySymbol, let secondaryAction {
                    Button {
                        secondaryAction()
                    } label: {
                        Label(secondaryTitle, systemImage: secondarySymbol)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct DiagnosticsCard: View {
    let state: RecorderState
    let activeRecordingKind: DesktopRecordingKind?
    let testVideoBackend: () -> Void
    let testAudioBackend: () -> Void

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: 12) {
                Label("Diagnostics", systemImage: "wrench.and.screwdriver")
                    .font(.headline)

                HStack(spacing: 10) {
                    Button {
                        testVideoBackend()
                    } label: {
                        Label("Test Video Backend", systemImage: "checkmark.seal")
                    }
                    .disabled(state == .signedOut || activeRecordingKind != nil)

                    Button {
                        testAudioBackend()
                    } label: {
                        Label("Test Audio Backend", systemImage: "checkmark.seal")
                    }
                    .disabled(state == .signedOut || activeRecordingKind != nil)
                }
            }
        }
    }
}

private struct MeetingPromptView: View {
    let context: MeetingContext
    let start: () -> Void
    let dismiss: () -> Void
    let startDisabled: Bool

    var body: some View {
        Card {
            HStack(alignment: .center, spacing: 14) {
                Image(systemName: "waveform.circle.fill")
                    .font(.system(size: 28, weight: .semibold))
                    .foregroundStyle(.green)

                VStack(alignment: .leading, spacing: 3) {
                    Text("Meeting ready")
                        .font(.headline)
                    Text(context.suggestedTitle)
                        .font(.subheadline.weight(.medium))
                        .lineLimit(1)
                    Text(context.sourceContextHint)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                Spacer()

                Button("Not now", action: dismiss)
                Button {
                    start()
                } label: {
                    Label("Start Note", systemImage: "waveform")
                }
                .buttonStyle(.borderedProminent)
                .tint(.green)
                .disabled(startDisabled)
            }
        }
    }
}

/// Camera + mic device pickers. Persists choice via the view model;
/// the recording flow reads selectedCameraDeviceID / selectedMicDeviceID
/// when starting a composite recording. Refresh button re-enumerates
/// devices (useful when a device was just plugged in).
private struct SourcePickerCard: View {
    let cameras: [MediaDeviceSource]
    let microphones: [MediaDeviceSource]
    let selectedCameraID: String?
    let selectedMicID: String?
    let onSelectCamera: (String?) -> Void
    let onSelectMic: (String?) -> Void
    let onRefresh: () -> Void

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Label("Sources", systemImage: "camera.metering.spot")
                        .font(.headline)
                    Spacer()
                    Button {
                        onRefresh()
                    } label: {
                        Label("Refresh", systemImage: "arrow.clockwise")
                            .labelStyle(.iconOnly)
                    }
                    .buttonStyle(.borderless)
                    .help("Re-enumerate connected devices")
                }
                Picker("Camera", selection: Binding(
                    get: { selectedCameraID ?? "__default__" },
                    set: { value in
                        onSelectCamera(value == "__default__" ? nil : value)
                    }
                )) {
                    Text("System default").tag("__default__")
                    ForEach(cameras) { device in
                        Text(device.name).tag(device.id)
                    }
                }
                .pickerStyle(.menu)
                Picker("Microphone", selection: Binding(
                    get: { selectedMicID ?? "__default__" },
                    set: { value in
                        onSelectMic(value == "__default__" ? nil : value)
                    }
                )) {
                    Text("System default").tag("__default__")
                    ForEach(microphones) { device in
                        Text(device.name).tag(device.id)
                    }
                }
                .pickerStyle(.menu)
                Text("Camera change applies immediately. Mic change applies on the next recording.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }
}

private struct CaptureSourcesView: View {
    let snapshot: CaptureSourceSnapshot

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: 12) {
                Label("Sources", systemImage: "rectangle.3.group")
                    .font(.headline)

                Grid(alignment: .leading, horizontalSpacing: 18, verticalSpacing: 8) {
                    SourceRow(
                        title: "Displays",
                        value: snapshot.displays
                            .map { "\($0.width)x\($0.height)" }
                            .joined(separator: ", ")
                    )
                    SourceRow(
                        title: "Cameras",
                        value: snapshot.cameras.map(\.name).joined(separator: ", ")
                    )
                    SourceRow(
                        title: "Mics",
                        value: snapshot.microphones
                            .map(\.name)
                            .joined(separator: ", ")
                    )
                    SourceRow(
                        title: "Windows",
                        value: snapshot.windows
                            .prefix(8)
                            .map { "\($0.applicationName): \($0.title)" }
                            .joined(separator: ", ")
                    )
                }
                .font(.caption)
            }
        }
    }
}

private struct SourceRow: View {
    let title: String
    let value: String

    var body: some View {
        GridRow(alignment: .top) {
            Text(title)
                .fontWeight(.semibold)
                .foregroundStyle(.primary)
            Text(value.isEmpty ? "None found" : value)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
                .multilineTextAlignment(.leading)
        }
    }
}

private struct StatusCard: View {
    let message: String

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: 8) {
                Label("Status", systemImage: "info.circle")
                    .font(.headline)
                Text(message)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

private struct FooterBar: View {
    let refreshSources: () -> Void
    let openLibrary: () -> Void
    let signOut: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Button {
                refreshSources()
            } label: {
                Label("Refresh Sources", systemImage: "arrow.clockwise")
            }

            Spacer()

            Button {
                openLibrary()
            } label: {
                Label("Open Library", systemImage: "rectangle.stack")
            }

            Button {
                signOut()
            } label: {
                Label("Sign Out", systemImage: "rectangle.portrait.and.arrow.right")
            }
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 14)
        .background(.bar)
    }
}

private struct Card<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        content
            .padding(.horizontal, DSSpacing.xl)
            .padding(.vertical, DSSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(DSColor.Bg.surface, in: RoundedRectangle(cornerRadius: DSRadius.lg))
            .dsShadow(.subtle)
    }
}

private struct StatusPill: View {
    let state: RecorderState

    var body: some View {
        Text(state.label)
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 11)
            .padding(.vertical, 6)
            .background(.quaternary, in: Capsule())
    }
}

/// Collapsed-by-default disclosure for developer-only UI (backend test
/// buttons, etc.) so the main app surface feels production-y while the
/// affordances stay one click away during active development.
private struct DeveloperToolsDisclosure<Content: View>: View {
    @State private var expanded = false
    @ViewBuilder var content: () -> Content

    var body: some View {
        DisclosureGroup(isExpanded: $expanded) {
            content()
                .padding(.top, 6)
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "hammer")
                    .font(.system(size: 11, weight: .semibold))
                Text("Developer tools")
                    .font(.caption.weight(.semibold))
            }
            .foregroundStyle(.secondary)
            .padding(.vertical, 4)
        }
        .padding(.horizontal, 6)
    }
}

/// Renders the loomola brand mark from the bundled PNG when available,
/// falling back to a generic recording-themed system icon when running
/// outside the .app bundle (e.g. raw `swift run` for fast iteration).
private struct BrandLogoMark: View {
    let size: CGFloat

    var body: some View {
        if let image = NSImage(named: "loomola-logo-mark") {
            Image(nsImage: image)
                .resizable()
                .interpolation(.high)
                .aspectRatio(contentMode: .fit)
                .frame(width: size, height: size)
        } else {
            ZStack {
                RoundedRectangle(cornerRadius: size * 0.24)
                    .fill(.linearGradient(
                        colors: [.blue.opacity(0.92), .green.opacity(0.86)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    ))
                Image(systemName: "waveform.and.video")
                    .font(.system(size: size * 0.45, weight: .semibold))
                    .foregroundStyle(.white)
            }
            .frame(width: size, height: size)
        }
    }
}

