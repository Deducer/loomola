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
    @State private var sidebarOpen = false
    @State private var sidebarQuery = ""
    @State private var folderFilterId: String? = nil
    /// Granola-shape one-window note workspace. When non-nil, the
    /// main window swaps its content for the workspace UI; nil
    /// shows the home shell (sidebar + capture / Recent strip).
    /// Single window means the user can move it between desktops
    /// in Mission Control — the previous floating-NSPanel approach
    /// (canJoinAllSpaces + stationary) was painted on every space
    /// and could not be dragged.
    @State private var noteTarget: NoteWorkspaceTarget? = nil

    var body: some View {
        VStack(spacing: 0) {
            // In note-workspace mode the workspace's own home/⋯ row
            // (rendered inline with the macOS traffic lights via
            // `.ignoresSafeArea(.all, edges: .top)`) replaces this
            // chrome — Granola pattern, single top bar.
            if noteTarget == nil {
                CustomTitleBar(
                    userInitial: viewModel.email.first,
                    sidebarOpen: sidebarOpen,
                    onToggleSidebar: { withAnimation(LoomolaMotion.quick) { sidebarOpen.toggle() } },
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
                                onOpenLibrary: openDashboard,
                                onSignOut: {
                                    showAccountMenu = false
                                    viewModel.signOut()
                                }
                            )
                        }
                }

                Divider().overlay(DSColor.Border.subtle)
            }

            ZStack(alignment: .leading) {
                contentForCurrentState

                // Dim layer over the content when sidebar is open;
                // tapping it closes the sidebar.
                if sidebarOpen {
                    Color.black.opacity(0.25)
                        .ignoresSafeArea()
                        .contentShape(Rectangle())
                        .onTapGesture {
                            withAnimation(LoomolaMotion.quick) { sidebarOpen = false }
                        }
                        .transition(.opacity)
                }

                if sidebarOpen {
                    SidebarPanel(
                        folders: viewModel.recentRecordings.folders,
                        query: $sidebarQuery,
                        selectedFolderId: $folderFilterId,
                        onClose: {
                            withAnimation(LoomolaMotion.quick) { sidebarOpen = false }
                        }
                    )
                    .transition(.move(edge: .leading))
                }
            }
        }
        .background(DSColor.Bg.canvas)
        .background(
            // ⌘S to toggle the sidebar — Granola convention.
            Button("") {
                withAnimation(LoomolaMotion.quick) { sidebarOpen.toggle() }
            }
            .keyboardShortcut("s", modifiers: .command)
            .opacity(0)
        )
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
            updateNoteTarget()
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
        .onChange(of: viewModel.state) { _, newState in
            // After a successful upload, hold the "Uploaded" success
            // surface for ~1.5s, then slide back to idle so the user
            // can start the next recording.
            if case .complete = newState {
                Task { @MainActor in
                    try? await Task.sleep(nanoseconds: 1_500_000_000)
                    viewModel.acknowledgeUploadComplete()
                }
            }
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

    /// Routes by (workspace, state, recordingKind, permissions) to
    /// the right view. The workspace check comes first — when the
    /// user is reviewing or live-authoring a note, that surface
    /// owns the whole window.
    @ViewBuilder
    private var contentForCurrentState: some View {
        if let target = noteTarget {
            NoteWorkspaceView(
                viewModel: viewModel,
                target: target,
                onClose: { noteTarget = nil }
            )
        } else if viewModel.state == .signedOut {
            SignedOutHomeView(viewModel: viewModel)
        } else if !dismissedPreflight && permissionStatus.requiredMissing {
            PermissionsHomeView(
                onComplete: {
                    permissionStatus = PermissionChecker.currentStatus()
                    dismissedPreflight = !permissionStatus.requiredMissing
                },
                onSkip: { dismissedPreflight = true }
            )
        } else if viewModel.activeRecordingKind == .video {
            // Video keeps its dedicated full-window recording surface.
            RecordingHomeView(viewModel: viewModel)
        } else if isFinalizingOrUploading(viewModel.state) {
            FinalizingHomeView(viewModel: viewModel)
        } else {
            IdleHomeView(
                viewModel: viewModel,
                recentService: viewModel.recentRecordings,
                captureMode: $captureMode,
                folderFilterId: $folderFilterId,
                onOpenAudioNote: { recording in
                    noteTarget = .reviewing(recording: recording)
                }
            )
        }
    }

    /// True for states that mean "the user already hit Stop and the
    /// upload is in flight" — drives the FinalizingHomeView. Also
    /// matches `.complete` briefly so the success checkmark gets a
    /// moment on screen before we route back to idle (handled by a
    /// .onChange auto-dismiss timer below).
    private func isFinalizingOrUploading(_ state: RecorderState) -> Bool {
        switch state {
        case .finalizing, .uploading, .complete:
            return true
        default:
            return false
        }
    }

    private var audioStartDisabled: Bool {
        viewModel.state == .signedOut ||
            viewModel.activeRecordingKind != nil ||
            viewModel.isStartingRecording ||
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
            join: { viewModel.joinDetectedMeeting() },
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
        // The Granola-style NotesSidePanel replaces the small
        // floating capsule for audio note recordings — having both
        // is redundant. Keep the capsule controller wired up but
        // never show it for audio. (Video recording still uses
        // VideoRecordingWindowController for its top-center HUD.)
        audioRecordingWindow.hide()
    }

    /// Auto-swap the main window into note-workspace mode when an
    /// audio note recording starts; on stop, swap back to the home
    /// shell so the user can browse Recent / start the next note.
    /// In review mode (user clicked an audio row in Recent), the
    /// target is set explicitly via `onOpenAudioNote`; this helper
    /// only handles the recording-mode auto-swap.
    private func updateNoteTarget() {
        if viewModel.activeRecordingKind == .audio {
            noteTarget = .recording
        } else if case .recording = noteTarget {
            // Active recording ended (Stop & upload, or Discard).
            // Tear the workspace down so the user lands on home.
            noteTarget = nil
        }
    }
}
