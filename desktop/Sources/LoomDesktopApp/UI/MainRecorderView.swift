import SwiftUI

struct MainRecorderView: View {
    @StateObject private var viewModel = RecorderViewModel()
    @State private var meetingPromptWindow = MeetingPromptWindowController()
    @State private var audioRecordingWindow = AudioRecordingWindowController()
    @FocusState private var focusedField: FocusedField?

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Loom Desktop")
                        .font(.title2.weight(.semibold))
                    Text("Native recorder scaffold")
                        .foregroundStyle(.secondary)
                }
                Spacer()
                StatusPill(state: viewModel.state)
            }

            Divider()

            if viewModel.state == .signedOut {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Sign in")
                        .font(.headline)
                    TextField("Email", text: $viewModel.email)
                        .textFieldStyle(.roundedBorder)
                        .focused($focusedField, equals: .email)
                    SecureField("Password", text: $viewModel.password)
                        .textFieldStyle(.roundedBorder)
                        .focused($focusedField, equals: .password)
                    Button("Sign in") {
                        viewModel.signIn()
                    }
                    .keyboardShortcut(.return, modifiers: [.command])
                }
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    Text("v1 scope")
                        .font(.headline)
                    Text("Sign in, capture one screen, show a draggable camera bubble, upload through the existing Loom Clone backend, then open the web dashboard.")
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                VStack(alignment: .leading, spacing: 10) {
                    Text("Granola audio note")
                        .font(.headline)
                    if let meetingPromptContext = viewModel.meetingPromptContext {
                        MeetingPromptView(
                            context: meetingPromptContext,
                            start: { viewModel.startDetectedMeetingAudioNote() },
                            dismiss: { viewModel.dismissMeetingPrompt() },
                            startDisabled: viewModel.activeRecordingKind != nil ||
                                (!viewModel.includeMicInAudioNote && !viewModel.includeSystemAudioInAudioNote)
                        )
                    }
                    TextField("Optional title", text: $viewModel.audioTitle)
                        .textFieldStyle(.roundedBorder)
                    HStack {
                        Toggle("Mic", isOn: $viewModel.includeMicInAudioNote)
                        Toggle("System audio", isOn: $viewModel.includeSystemAudioInAudioNote)
                    }
                    if let meetingContext = viewModel.meetingContext {
                        Text("Detected \(meetingContext.detectedApp): \(meetingContext.sourceContextHint)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                    HStack {
                        Button("Start Audio Note") {
                            viewModel.startAudioNoteRecording()
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(
                            viewModel.state == .signedOut ||
                            viewModel.activeRecordingKind != nil ||
                            (!viewModel.includeMicInAudioNote && !viewModel.includeSystemAudioInAudioNote)
                        )

                        Button("Stop Audio") {
                            viewModel.stopAudioNoteRecordingAndUpload()
                        }
                        .disabled(viewModel.activeRecordingKind != .audio)

                        Button("Discard Audio") {
                            viewModel.cancelAudioNoteRecording()
                        }
                        .disabled(viewModel.activeRecordingKind != .audio)

                        Button("Test Audio Backend") {
                            viewModel.startAndAbortAudioBackendHandshake()
                        }
                        .disabled(viewModel.state == .signedOut)

                        Button("Check Meeting") {
                            viewModel.checkMeetingContext()
                        }
                        .disabled(viewModel.state == .signedOut)
                    }
                }

                VStack(alignment: .leading, spacing: 8) {
                    Text("Chrome meeting bridge")
                        .font(.headline)
                    Text(viewModel.nativeMessagingStatus)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    HStack {
                        Button(viewModel.isInstallingNativeMessagingHost ? "Installing..." : "Install Chrome Bridge") {
                            viewModel.installNativeMessagingHost()
                        }
                        .disabled(viewModel.isInstallingNativeMessagingHost)

                        Button("Show Extension Folder") {
                            viewModel.openExtensionFolder()
                        }
                    }
                }
            }

            VStack(alignment: .leading, spacing: 8) {
                Text("Status")
                    .font(.headline)
                Text(viewModel.statusMessage)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            CaptureSourcesView(snapshot: viewModel.captureSources)

            Spacer()

            HStack {
                Button("Start Video Recording") {
                    viewModel.startLocalRecording()
                }
                .keyboardShortcut("r", modifiers: [.command])
                .disabled(viewModel.state == .signedOut || viewModel.activeRecordingKind != nil)

                Button("Stop Video") {
                    viewModel.stopLocalRecordingAndUpload()
                }
                .disabled(viewModel.activeRecordingKind != .video)

                Button("Test Backend") {
                    viewModel.startAndAbortBackendHandshake()
                }
                .disabled(viewModel.state == .signedOut)

                Button("Refresh Sources") {
                    viewModel.refreshCaptureSources()
                }

                Spacer()

                Button("Sync Obsidian") {
                    viewModel.syncPendingObsidianNotes()
                }
                .disabled(viewModel.state == .signedOut)

                Button("Open Dashboard") {
                    NSWorkspace.shared.open(URL(string: "https://loom.dissonance.cloud")!)
                }

                if viewModel.state != .signedOut {
                    Button("Sign Out") {
                        viewModel.signOut()
                    }
                }
            }
        }
        .padding(24)
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
        .onChange(of: viewModel.activeRecordingKind) { _, _ in
            updateMeetingPromptWindow()
            updateAudioRecordingWindow()
        }
        .onChange(of: viewModel.activeAudioRecordingStartedAt) { _, _ in
            updateAudioRecordingWindow()
        }
        .onChange(of: viewModel.audioTitle) { _, _ in
            updateAudioRecordingWindow()
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
        }
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
            startDisabled: viewModel.activeRecordingKind != nil ||
                (!viewModel.includeMicInAudioNote && !viewModel.includeSystemAudioInAudioNote),
            start: { viewModel.startDetectedMeetingAudioNote() },
            dismiss: { viewModel.dismissMeetingPrompt() }
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
            stop: { viewModel.stopAudioNoteRecordingAndUpload() },
            discard: { viewModel.cancelAudioNoteRecording() }
        )
    }
}

private enum FocusedField: Hashable {
    case email
    case password
}

private struct MeetingPromptView: View {
    let context: MeetingContext
    let start: () -> Void
    let dismiss: () -> Void
    let startDisabled: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Meeting ready")
                        .font(.subheadline.weight(.semibold))
                    Text("\(context.suggestedTitle) · \(context.detectedApp)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Spacer()
                Button("Not now", action: dismiss)
                Button("Start") {
                    start()
                }
                .buttonStyle(.borderedProminent)
                .disabled(startDisabled)
            }
            Text(context.sourceContextHint)
                .font(.caption2)
                .foregroundStyle(.tertiary)
                .lineLimit(1)
        }
        .padding(10)
        .background(.quaternary, in: RoundedRectangle(cornerRadius: 8))
    }
}

private struct CaptureSourcesView: View {
    let snapshot: CaptureSourceSnapshot

    var body: some View {
        Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 6) {
            GridRow {
                Text("Displays").font(.caption.weight(.semibold))
                Text(snapshot.displays.prefix(2).map { "\($0.width)x\($0.height)" }.joined(separator: ", "))
                    .foregroundStyle(.secondary)
            }
            GridRow {
                Text("Cameras").font(.caption.weight(.semibold))
                Text(snapshot.cameras.prefix(2).map(\.name).joined(separator: ", "))
                    .foregroundStyle(.secondary)
            }
            GridRow {
                Text("Mics").font(.caption.weight(.semibold))
                Text(snapshot.microphones.prefix(2).map(\.name).joined(separator: ", "))
                    .foregroundStyle(.secondary)
            }
            GridRow {
                Text("Windows").font(.caption.weight(.semibold))
                Text(snapshot.windows.prefix(2).map { "\($0.applicationName): \($0.title)" }.joined(separator: ", "))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .font(.caption)
    }
}

private struct StatusPill: View {
    let state: RecorderState

    var body: some View {
        Text(state.label)
            .font(.caption.weight(.medium))
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(.quaternary, in: Capsule())
    }
}
