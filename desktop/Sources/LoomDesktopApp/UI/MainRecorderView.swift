import AppKit
import SwiftUI

struct MainRecorderView: View {
    @StateObject private var viewModel = RecorderViewModel()
    @State private var meetingPromptWindow = MeetingPromptWindowController()
    @State private var audioRecordingWindow = AudioRecordingWindowController()
    @State private var videoRecordingWindow = VideoRecordingWindowController()
    @State private var permissionStatus: PermissionStatus = PermissionChecker.currentStatus()
    @State private var dismissedPreflight = false
    @State private var captureMode: CaptureMode = .video
    @State private var showSettings = false
    @State private var showAccountMenu = false

    var body: some View {
        VStack(spacing: 0) {
            CustomTitleBar(
                userInitial: viewModel.email.first,
                onSettings: { showSettings = true },
                onAccount: { showAccountMenu.toggle() }
            )
            .overlay(alignment: .topTrailing) {
                // Anchor for the popover. Empty view positioned where
                // the avatar sits (~30pt from the right edge, at the
                // title bar's vertical center).
                Color.clear
                    .frame(width: 30, height: 30)
                    .padding(.trailing, DSSpacing.lg)
                    .popover(isPresented: $showAccountMenu, arrowEdge: .top) {
                        AccountMenuPopover(
                            email: viewModel.email.isEmpty ? nil : viewModel.email,
                            onOpenDashboard: openDashboard,
                            onOpenLibrary: openDashboard,
                            onSignOut: {
                                showAccountMenu = false
                                viewModel.signOut()
                            }
                        )
                    }
            }

            Divider().overlay(DSColor.Border.subtle)

            contentForCurrentState
        }
        .background(DSColor.Bg.canvas)
        .sheet(isPresented: $showSettings) {
            SettingsSheet(onDismiss: { showSettings = false })
                .environmentObject(viewModel)
        }
        .onAppear {
            AppActivation.bringRecorderToFront()
        }
        .task {
            await viewModel.restoreSession()
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
    private func openDashboard() {
        if let url = URL(string: "https://loom.dissonance.cloud") {
            NSWorkspace.shared.open(url)
        }
        showAccountMenu = false
    }

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

    /// Routes by (state, recordingKind, permissions) to the right
    /// home view. Phase 3 lands the IdleHomeView; legacy `signedInBody`
    /// is the temporary fallback for recording / permissions states
    /// until Phases 4 + 5 swap them in.
    @ViewBuilder
    private var contentForCurrentState: some View {
        if viewModel.state == .signedOut {
            SignedOutHomeView(viewModel: viewModel)
        } else if !dismissedPreflight && permissionStatus.requiredMissing {
            PermissionsHomeView(
                onComplete: {
                    permissionStatus = PermissionChecker.currentStatus()
                    dismissedPreflight = !permissionStatus.requiredMissing
                },
                onSkip: { dismissedPreflight = true }
            )
        } else if viewModel.activeRecordingKind != nil {
            RecordingHomeView(viewModel: viewModel)
        } else {
            IdleHomeView(
                viewModel: viewModel,
                recentService: viewModel.recentRecordings,
                captureMode: $captureMode
            )
        }
    }

    private var audioStartDisabled: Bool {
        viewModel.state == .signedOut ||
            viewModel.activeRecordingKind != nil ||
            (!viewModel.includeMicInAudioNote && !viewModel.includeSystemAudioInAudioNote)
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
