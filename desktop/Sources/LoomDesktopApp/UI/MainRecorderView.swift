import AppKit
import SwiftUI

struct MainRecorderView: View {
    @StateObject private var viewModel = RecorderViewModel()
    @State private var meetingPromptWindow = MeetingPromptWindowController()
    @State private var audioRecordingWindow = AudioRecordingWindowController()
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

    private var signedInBody: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if let context = viewModel.meetingPromptContext {
                        MeetingPromptView(
                            context: context,
                            start: { viewModel.startDetectedMeetingAudioNote() },
                            dismiss: { viewModel.dismissMeetingPrompt() },
                            startDisabled: audioStartDisabled
                        )
                    }

                    LazyVGrid(
                        columns: [
                            GridItem(.flexible(minimum: 320), spacing: 16),
                            GridItem(.flexible(minimum: 320), spacing: 16),
                        ],
                        alignment: .leading,
                        spacing: 16
                    ) {
                        LoomCard(
                            state: viewModel.state,
                            activeRecordingKind: viewModel.activeRecordingKind,
                            start: { viewModel.startLocalRecording() },
                            stop: { viewModel.stopLocalRecordingAndUpload() },
                            test: { viewModel.startAndAbortBackendHandshake() }
                        )

                        GranolaCard(
                            title: $viewModel.audioTitle,
                            includeMic: $viewModel.includeMicInAudioNote,
                            includeSystemAudio: $viewModel.includeSystemAudioInAudioNote,
                            state: viewModel.state,
                            activeRecordingKind: viewModel.activeRecordingKind,
                            meetingContext: viewModel.meetingContext,
                            startDisabled: audioStartDisabled,
                            start: { viewModel.startAudioNoteRecording() },
                            stop: { viewModel.stopAudioNoteRecordingAndUpload() },
                            discard: { viewModel.cancelAudioNoteRecording() },
                            test: { viewModel.startAndAbortAudioBackendHandshake() },
                            checkMeeting: { viewModel.checkMeetingContext() }
                        )
                    }

                    IntegrationsCard(
                        nativeMessagingStatus: viewModel.nativeMessagingStatus,
                        isInstallingNativeMessagingHost: viewModel.isInstallingNativeMessagingHost,
                        installChromeBridge: { viewModel.installNativeMessagingHost() },
                        showExtensionFolder: { viewModel.openExtensionFolder() },
                        syncObsidian: { viewModel.syncPendingObsidianNotes() }
                    )

                    CaptureSourcesView(snapshot: viewModel.captureSources)

                    StatusCard(message: viewModel.statusMessage)
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

private struct AppHeader: View {
    let state: RecorderState

    var body: some View {
        HStack(spacing: 14) {
            ZStack {
                RoundedRectangle(cornerRadius: 10)
                    .fill(.linearGradient(
                        colors: [.blue.opacity(0.92), .green.opacity(0.86)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    ))
                Image(systemName: "waveform.and.video")
                    .font(.system(size: 19, weight: .semibold))
                    .foregroundStyle(.white)
            }
            .frame(width: 42, height: 42)

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

private struct LoomCard: View {
    let state: RecorderState
    let activeRecordingKind: DesktopRecordingKind?
    let start: () -> Void
    let stop: () -> Void
    let test: () -> Void

    var body: some View {
        ProductCard(
            title: "Loom",
            subtitle: "Screen recording",
            symbol: "video.fill",
            tint: .blue
        ) {
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 10) {
                    Button {
                        start()
                    } label: {
                        Label("Start Video", systemImage: "record.circle")
                    }
                    .buttonStyle(.borderedProminent)
                    .keyboardShortcut("r", modifiers: [.command])
                    .disabled(state == .signedOut || activeRecordingKind != nil)

                    Button {
                        stop()
                    } label: {
                        Label("Stop", systemImage: "stop.fill")
                    }
                    .disabled(activeRecordingKind != .video)
                }

                Button {
                    test()
                } label: {
                    Label("Test Video Backend", systemImage: "checkmark.seal")
                }
                .disabled(state == .signedOut)
            }
        }
    }
}

private struct GranolaCard: View {
    @Binding var title: String
    @Binding var includeMic: Bool
    @Binding var includeSystemAudio: Bool
    let state: RecorderState
    let activeRecordingKind: DesktopRecordingKind?
    let meetingContext: MeetingContext?
    let startDisabled: Bool
    let start: () -> Void
    let stop: () -> Void
    let discard: () -> Void
    let test: () -> Void
    let checkMeeting: () -> Void

    var body: some View {
        ProductCard(
            title: "Granola",
            subtitle: meetingContext == nil ? "Audio notes" : "Meeting detected",
            symbol: "waveform.circle.fill",
            tint: .green
        ) {
            VStack(alignment: .leading, spacing: 12) {
                TextField("Optional title", text: $title)
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
                    Button {
                        start()
                    } label: {
                        Label("Start Note", systemImage: "waveform")
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.green)
                    .disabled(startDisabled)

                    Button {
                        stop()
                    } label: {
                        Label("Stop", systemImage: "stop.fill")
                    }
                    .disabled(activeRecordingKind != .audio)

                    Button {
                        discard()
                    } label: {
                        Label("Discard", systemImage: "trash")
                    }
                    .disabled(activeRecordingKind != .audio)
                }

                HStack(spacing: 10) {
                    Button {
                        checkMeeting()
                    } label: {
                        Label("Check Meeting", systemImage: "sparkle.magnifyingglass")
                    }
                    .disabled(state == .signedOut)

                    Button {
                        test()
                    } label: {
                        Label("Test Audio Backend", systemImage: "checkmark.seal")
                    }
                    .disabled(state == .signedOut)
                }
            }
        }
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

private struct CaptureSourcesView: View {
    let snapshot: CaptureSourceSnapshot

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: 12) {
                Label("Sources", systemImage: "rectangle.3.group")
                    .font(.headline)

                Grid(alignment: .leading, horizontalSpacing: 18, verticalSpacing: 8) {
                    SourceRow(title: "Displays", value: snapshot.displays.prefix(2).map { "\($0.width)x\($0.height)" }.joined(separator: ", "))
                    SourceRow(title: "Cameras", value: snapshot.cameras.prefix(2).map(\.name).joined(separator: ", "))
                    SourceRow(title: "Mics", value: snapshot.microphones.prefix(2).map(\.name).joined(separator: ", "))
                    SourceRow(title: "Windows", value: snapshot.windows.prefix(2).map { "\($0.applicationName): \($0.title)" }.joined(separator: ", "))
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
        GridRow {
            Text(title)
                .fontWeight(.semibold)
                .foregroundStyle(.primary)
            Text(value.isEmpty ? "None found" : value)
                .foregroundStyle(.secondary)
                .lineLimit(1)
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

private struct ProductCard<Content: View>: View {
    let title: String
    let subtitle: String
    let symbol: String
    let tint: Color
    @ViewBuilder let content: Content

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: 16) {
                HStack(spacing: 12) {
                    Image(systemName: symbol)
                        .font(.system(size: 24, weight: .semibold))
                        .foregroundStyle(tint)
                        .frame(width: 34, height: 34)

                    VStack(alignment: .leading, spacing: 2) {
                        Text(title)
                            .font(.title3.weight(.semibold))
                        Text(subtitle)
                            .font(.caption.weight(.medium))
                            .foregroundStyle(.secondary)
                    }

                    Spacer()
                }

                content
            }
        }
    }
}

private struct Card<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        content
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(nsColor: .controlBackgroundColor), in: RoundedRectangle(cornerRadius: 8))
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(Color.primary.opacity(0.08), lineWidth: 1)
            )
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
