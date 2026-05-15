import AppKit
import SwiftUI

struct MainRecorderView: View {
    @StateObject private var viewModel = RecorderViewModel()
    @State private var meetingPromptWindow = MeetingPromptWindowController()
    @State private var videoRecordingWindow = VideoRecordingWindowController()
    /// Granola-shape always-visible audio-recording reminder. Small
    /// vertical capsule that floats on every Space and every app
    /// while audio is recording, so the user never loses track even
    /// when in another desktop / app. Replaces the Stage-8 in-app
    /// `RecordingStatusPill`. Spec:
    /// docs/superpowers/specs/2026-05-06-floating-recording-pill-design.md.
    @State private var recordingStatusOverlay = RecordingStatusOverlayController()
    @State private var permissionStatus: PermissionStatus = PermissionChecker.currentStatus()
    @State private var dismissedPreflight = false
    @State private var captureMode: CaptureMode = .video
    @State private var showSettings = false
    @State private var showAccountMenu = false
    @State private var sidebarOpen = false
    @State private var sidebarQuery = ""
    @State private var folderFilterId: String? = nil
    @State private var hostWindow: NSWindow?
    @State private var windowIsFullScreen = false
    @State private var windowIsExpanded = false
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
        .overlay(alignment: .top) {
            if noteTarget == nil {
                homeTitleBar
            }
        }
        .background(
            WindowAccessor { window in
                hostWindow = window
                WindowChrome.applyTallTitleBar(to: window)
                updateWindowLayoutState(window)
                updateWindowCloseState(window)
            }
        )
        .background(
            // ⌘S to toggle the sidebar — Granola convention.
            Button("") {
                withAnimation(LoomolaMotion.quick) { sidebarOpen.toggle() }
            }
            .keyboardShortcut("s", modifiers: .command)
            .opacity(0)
        )
        .animation(LoomolaMotion.medium, value: viewModel.activeRecordingKind)
        .animation(LoomolaMotion.medium, value: noteTarget)
        .sheet(isPresented: $showSettings) {
            SettingsSheet(onDismiss: { showSettings = false })
                .environmentObject(viewModel)
        }
        .onAppear {
            AppActivation.bringRecorderToFront()
            viewModel.setReadinessMode(captureMode.readinessMode)
            viewModel.refreshRecorderReadiness()
        }
        .onReceive(NotificationCenter.default.publisher(for: NSWindow.didEnterFullScreenNotification)) { notification in
            guard notification.object as? NSWindow === hostWindow else { return }
            updateWindowLayoutState()
        }
        .onReceive(NotificationCenter.default.publisher(for: NSWindow.didExitFullScreenNotification)) { notification in
            guard notification.object as? NSWindow === hostWindow else { return }
            updateWindowLayoutState()
        }
        .onReceive(NotificationCenter.default.publisher(for: NSWindow.didResizeNotification)) { notification in
            guard notification.object as? NSWindow === hostWindow else { return }
            updateWindowLayoutState()
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
        .onChange(of: captureMode) { _, mode in
            viewModel.setReadinessMode(mode.readinessMode)
            updateMeetingPromptWindow()
        }
        .onChange(of: viewModel.activeRecordingKind) { _, kind in
            updateMeetingPromptWindow()
            updateRecordingStatusOverlay()
            updateVideoRecordingWindow()
            updateNoteTarget()
            RecorderCommands.isVideoRecording = (kind == .video)
            RecorderCommands.isAudioRecording = (kind == .audio)
            updateWindowCloseState()
        }
        .onChange(of: viewModel.audioLevel) { _, level in
            videoRecordingWindow.updateLevel(level)
        }
        .onChange(of: viewModel.includeMicInAudioNote) { _, _ in
            updateMeetingPromptWindow()
            viewModel.refreshRecorderReadiness()
        }
        .onChange(of: viewModel.includeSystemAudioInAudioNote) { _, _ in
            updateMeetingPromptWindow()
            viewModel.refreshRecorderReadiness()
        }
        .onChange(of: viewModel.floatingRecordingIndicatorEnabled) { _, _ in
            updateRecordingStatusOverlay()
        }
        .onDisappear {
            meetingPromptWindow.hide()
            if viewModel.activeRecordingKind == nil {
                recordingStatusOverlay.hide()
            }
            videoRecordingWindow.hide()
        }
        .onReceive(NotificationCenter.default.publisher(for: RecorderCommands.toggleRecording)) { _ in
            handleToggleRecording()
        }
        .onReceive(NotificationCenter.default.publisher(for: RecorderCommands.discardRecordingAndQuit)) { _ in
            handleDiscardRecordingAndQuit()
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

    private func handleDiscardRecordingAndQuit() {
        Task { @MainActor in
            await viewModel.discardActiveRecordingForQuit()
            RecorderCommands.isVideoRecording = false
            RecorderCommands.isAudioRecording = false
            recordingStatusOverlay.hide()
            videoRecordingWindow.hide()
            noteTarget = nil
            NSApp.reply(toApplicationShouldTerminate: true)
        }
    }

    private var homeTitleBar: some View {
        HStack(alignment: .center) {
            HStack(spacing: DSSpacing.sm) {
                titleBarSidebarButton
                BrandLogoMark(size: 22)
                Text("Loomola")
                    .font(DSFont.Body.lg())
                    .foregroundStyle(DSColor.Text.primary)
                    .lineLimit(1)
            }

            Spacer()

            titleBarActions
        }
        .padding(.leading, 142)
        .padding(.trailing, DSSpacing.lg)
        .padding(.top, 8)
        .frame(height: 44)
        .offset(y: homeChromeYOffset)
    }

    private var homeChromeYOffset: CGFloat {
        windowIsExpanded ? 0 : -32
    }

    private var homeContentTopPadding: CGFloat {
        windowIsExpanded ? DSSpacing.xxl : DSSpacing.lg
    }

    private var titleBarSidebarButton: some View {
        Image(systemName: "sidebar.left")
            .font(.system(size: 14, weight: .medium))
            .foregroundStyle(DSColor.Text.secondary)
            .frame(width: 28, height: 28)
            .contentShape(Circle())
            .overlay {
                ActionHitArea {
                    withAnimation(LoomolaMotion.quick) { sidebarOpen.toggle() }
                }
                .clipShape(Circle())
            }
            .help(sidebarOpen ? "Close sidebar (⌘S)" : "Open sidebar (⌘S)")
    }

    private var titleBarActions: some View {
        HStack(spacing: DSSpacing.sm) {
            IconButton(icon: "gearshape", size: 30, action: { showSettings = true })
                .help("Settings")
            IconButton(
                text: viewModel.email.first.map { String($0).uppercased() } ?? "?",
                size: 30,
                action: { showAccountMenu.toggle() }
            )
            .help("Account")
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
        .padding(4)
        .background(
            Capsule().fill(DSColor.Bg.surface.opacity(0.9))
        )
        .overlay {
            Capsule().strokeBorder(DSColor.Border.subtle, lineWidth: 1)
        }
    }

    /// Bridges menubar / global-hotkey toggle requests to the view
    /// model. Decides start vs stop based on activeRecordingKind:
    ///   - nil → startLocalRecording (composite video)
    ///   - .video → stopLocalRecordingAndUpload
    ///   - .audio → no-op (audio note has its own start/stop UX)
    private func openDashboard() {
        viewModel.openLibrary()
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
                chromeYOffset: homeChromeYOffset,
                onClose: { noteTarget = nil }
            )
        } else if viewModel.state == .signedOut {
            SignedOutHomeView(viewModel: viewModel)
        } else if !dismissedPreflight && permissionStatus.requiredMissing {
            PermissionsHomeView(
                onComplete: {
                    permissionStatus = PermissionChecker.currentStatus()
                    dismissedPreflight = !permissionStatus.requiredMissing
                    viewModel.refreshRecorderReadiness()
                },
                onSkip: {
                    dismissedPreflight = true
                    viewModel.refreshRecorderReadiness()
                }
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
                topContentPadding: homeContentTopPadding,
                onOpenLiveAudioNote: { noteTarget = .recording },
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
            !viewModel.recorderReadiness.canStart ||
            (!viewModel.includeMicInAudioNote && !viewModel.includeSystemAudioInAudioNote)
    }

    private func updateWindowCloseState(_ window: NSWindow? = nil) {
        let window = window ?? hostWindow
        window?.standardWindowButton(.closeButton)?.isEnabled = (viewModel.activeRecordingKind == nil)
    }

    private func updateWindowLayoutState(_ window: NSWindow? = nil) {
        let window = window ?? hostWindow
        windowIsFullScreen = window?.styleMask.contains(.fullScreen) ?? false

        guard let window, let screen = window.screen else {
            windowIsExpanded = false
            return
        }

        let visibleFrame = screen.visibleFrame
        windowIsExpanded =
            windowIsFullScreen ||
            window.frame.width >= visibleFrame.width * 0.9 ||
            window.frame.height >= visibleFrame.height * 0.86
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

    /// Show / hide the floating cross-Spaces recording reminder
    /// pill based on whether an audio note is currently capturing.
    /// Tap brings the main window to the front and drops the user
    /// into the workspace bound to that recording — works whether
    /// the workspace is already open or not.
    private func updateRecordingStatusOverlay() {
        guard viewModel.floatingRecordingIndicatorEnabled else {
            recordingStatusOverlay.hide()
            return
        }
        if viewModel.activeRecordingKind == .audio {
            recordingStatusOverlay.show(viewModel: viewModel) {
                AppActivation.bringRecorderToFront()
                noteTarget = .recording
            }
        } else {
            recordingStatusOverlay.hide()
        }
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
            // Active recording ended. Stop & upload keeps the note
            // open in review mode so the Generate notes pill is right
            // where the user expects it; Discard has no review target.
            if let recording = viewModel.lastStoppedAudioRecordingForReview {
                noteTarget = .reviewing(recording: recording)
                viewModel.clearLastStoppedAudioRecordingForReview()
            } else {
                noteTarget = nil
            }
        }
    }
}
